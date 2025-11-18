# app/api/routes.py
import os
import uuid
import json
from flask import Blueprint, request, jsonify, current_app, g
from rq import Queue, Retry
from app import redis_client
from app.workers.tasks import process_symptoms
from app.db.supabase_client import (
    insert_recommendation_job, 
    get_recommendation_status,
    get_user_recommendations
)
from app.utils.security import validate_input, rate_limit_by_ip
from app.utils.metrics import track_api_request
from app.api.route_metrics import route_timed_execution
from app.config import active_config
from app.auth.middleware import optional_auth, require_auth
from app.auth.rate_limiter import increment_request_count
import requests

# Create blueprint
api_bp = Blueprint('api', __name__, url_prefix='/api/v1')

# Initialize Redis queue
queue = Queue(active_config.REDIS_QUEUE_NAME, connection=redis_client)

@api_bp.route('/health', methods=['GET'])
def health_check():
    """API health check endpoint."""
    track_api_request('health_check')
    
    # Check Redis connection
    redis_ok = False
    try:
        redis_ok = redis_client.ping()
    except:
        redis_ok = False
    
    # Check queue
    queue_count = 0
    try:
        queue_count = len(queue)
    except:
        pass
        
    # Return health status
    return jsonify({
        'status': 'ok',
        'redis_connected': redis_ok,
        'queue_size': queue_count,
        'version': '1.0.0',
    })

@api_bp.route('/recommendation', methods=['POST'])
@validate_input(max_length=active_config.MAX_QUERY_LENGTH)
@optional_auth  # Optional authentication
@route_timed_execution
def get_recommendation():
    """
    Create a new recommendation job.
    
    Anonymous users get 3 requests total.
    Free tier: 10 requests per day
    Premium tier: 50 requests per day
    
    Request body:
    {
        "symptoms": "string",
        "user_profile": {
            "age": number,
            "gender": "string",
            "allergies": [strings],
            "medication_history": [objects],
            "zip_code": "string"
        }
    }
    
    Response:
    {
        "job_id": "string",
        "status": "string"
    }
    """
    track_api_request('get_recommendation')
    
    try:
        # Get request data
        data = request.get_json() or {}
        user_query = data.get('symptoms', '').strip()
        user_profile = data.get('user_profile', {})
        
        # Validate input
        if not user_query:
            return jsonify({'error': 'Missing symptoms parameter'}), 400
            
        # Generate unique job ID
        job_id = str(uuid.uuid4())
        current_app.logger.info(f"Creating job {job_id} for query: {user_query}")
        
        # Check if user is authenticated
        user_id = None
        subscription_tier = 'anonymous'
        
        if hasattr(request, 'user') and not request.user.get('is_anonymous', False):
            user_id = request.user.get('user_id')
            subscription_tier = request.user.get('subscription_tier', 'free')
            
            # If user is authenticated but no profile data provided,
            # fetch it from database
            if not user_profile and user_id:
                from app.auth.services import get_user_profile
                profile = get_user_profile(user_id)
                if 'error' not in profile:
                    user_profile = profile
        
        # Rate limiting for authenticated users
        if user_id:
            # Check tier limits
            from app.auth.middleware import check_user_rate_limit
            limit_check = check_user_rate_limit(user_id, subscription_tier)
            
            if not limit_check['can_request']:
                return jsonify({
                    'error': 'Rate limit exceeded',
                    'limit': limit_check['limit'],
                    'count': limit_check['count'],
                    'tier': subscription_tier
                }), 429
        
        # Create job record in database
        try:
            job_data = {
                'job_id': job_id,
                'user_id': user_id,
                'user_query': user_query,
                'user_profile': json.dumps(user_profile) if user_profile else None,
                'status': 'queued',
                'subscription_tier': subscription_tier,
                'result': None
            }
            
            insert_recommendation_job(job_data)
        except Exception as e:
            current_app.logger.error(f"Database error: {str(e)}")
            return jsonify({'error': 'Failed to create job record'}), 500
        
        # For anonymous users, store job ID in the session for later counting
        if not user_id:
            # Store the job ID in the request context
            g.anonymous_job_id = job_id
            # Set flag for anonymous request (will be checked in status endpoint)
            redis_client.set(f"anon:job:{job_id}", request.remote_addr, ex=3600)  # 1 hour expiry
        
        # Enqueue background job with retry
        try:
            job = queue.enqueue(
                process_symptoms,
                user_query,
                job_id,
                user_profile,
                subscription_tier,
                job_id=job_id,
                retry=Retry(
                    max=active_config.MAX_RETRIES,
                    interval=active_config.RETRY_INTERVALS
                )
            )
            current_app.logger.info(f"Job {job_id} enqueued with ID: {job.id}")
        except Exception as e:
            current_app.logger.error(f"Queue error: {str(e)}")
            return jsonify({'error': 'Failed to enqueue job'}), 500

        # Return response with job ID
        return jsonify({
            'job_id': job_id, 
            'status': 'queued',
            'auth_status': 'authenticated' if user_id else 'anonymous'
        }), 202
        
    except Exception as e:
        current_app.logger.exception("Unexpected error in get_recommendation")
        return jsonify({'error': 'An unexpected error occurred'}), 500

@api_bp.route('/status/<job_id>', methods=['GET'])
@rate_limit_by_ip("60 per minute")
@optional_auth  # Optional authentication
@route_timed_execution
def get_status(job_id):
    """
    Get the status of a recommendation job.
    
    Path parameter:
    - job_id: Unique job ID
    
    Response:
    {
        "status": "string",
        "result": object
    }
    """
    track_api_request('get_status')
    
    try:
        # Validate job ID format
        try:
            uuid.UUID(job_id)  # Validate UUID format
        except ValueError:
            return jsonify({'error': 'Invalid job ID format'}), 400
        
        # Get job status from database
        job = get_recommendation_status(job_id)
        
        # Check if job exists
        if not job:
            return jsonify({'error': 'Job not found'}), 404
            
        # Check if user is authorized to view this job
        user_id = None
        is_admin = False
        
        if hasattr(request, 'user') and not request.user.get('is_anonymous', False):
            user_id = request.user.get('user_id')
            is_admin = request.user.get('role') == 'admin'
        
        # If job has a user_id and doesn't match the requesting user (and not admin)
        if job.get('user_id') and user_id != job.get('user_id') and not is_admin:
            return jsonify({'error': 'Unauthorized to view this job'}), 403
            
        # Prepare response
        payload = {'status': job['status']}
        
        # Include result if job is done
        if job['status'] == 'done':
            try:
                payload['result'] = json.loads(job['result'])
                
                # If this is an anonymous user and the job is done successfully,
                # now we increment the request count
                anon_ip = redis_client.get(f"anon:job:{job_id}")
                if anon_ip:
                    anon_ip = anon_ip.decode('utf-8')
                    # Increment request count
                    increment_request_count(anon_ip)
                    # Delete the job tracking key
                    redis_client.delete(f"anon:job:{job_id}")
                
            except (json.JSONDecodeError, TypeError):
                payload['result'] = job['result']
                
        # Include error message if job failed
        elif job['status'] == 'failed':
            payload['error'] = job['result']
            
        return jsonify(payload)
        
    except Exception as e:
        current_app.logger.exception(f"Error getting status for job {job_id}")
        return jsonify({'error': 'An unexpected error occurred'}), 500

@api_bp.route('/user/history', methods=['GET'])
@require_auth  # Requires authentication
@route_timed_execution
def get_user_recommendations_history():
    """
    Get a user's recommendation history.
    
    Response:
    {
        "recommendations": [
            {
                "job_id": "string",
                "user_query": "string",
                "status": "string",
                "created_at": "string",
                "result": object
            }
        ]
    }
    """
    track_api_request('get_user_recommendations')
    
    try:
        user_id = request.user['user_id']
        
        # Get recommendations from database
        recommendations = get_user_recommendations(user_id)
        
        # Format response
        formatted_recommendations = []
        for rec in recommendations:
            item = {
                'job_id': rec['job_id'],
                'user_query': rec['user_query'],
                'status': rec['status'],
                'created_at': rec['created_at']
            }
            
            # Include result if job is done
            if rec['status'] == 'done' and rec['result']:
                try:
                    item['result'] = json.loads(rec['result'])
                except:
                    item['result'] = rec['result']
            
            formatted_recommendations.append(item)
        
        return jsonify({'recommendations': formatted_recommendations})
    
    except Exception as e:
        current_app.logger.exception("Error getting user recommendations")
        return jsonify({'error': 'An unexpected error occurred'}), 500

@api_bp.route('/pharmacy/nearby', methods=['GET'])
@optional_auth  # Optional authentication
@route_timed_execution
def nearby_pharmacies():
    """
    Get nearby pharmacies based on zip code.
    
    Query parameters:
    - zip_code: ZIP code to search near
    - radius: Search radius in miles (default: 2)
    
    Response:
    {
        "pharmacies": [
            {
                "name": "string",
                "address": "string",
                "phone": "string",
                "distance": number,
                "hours": object
            }
        ]
    }
    """
    track_api_request('nearby_pharmacies')

    GOOGLE_API_KEY = os.environ.get('GOOGLE_MAPS_API_KEY')

    zip_code = request.args.get('zip_code')
    radius_miles = int(request.args.get('radius', 2))
    radius_meters = radius_miles * 1609  # convert miles to meters

    if not zip_code:
        return jsonify({'error': 'ZIP code is required'}), 400

    # --- Step 1: Geocode ZIP code ---
    geocode_url = f"https://maps.googleapis.com/maps/api/geocode/json?address={zip_code}&key={GOOGLE_API_KEY}"
    try:
        geocode_response = requests.get(geocode_url)
        geocode_response.raise_for_status()
        geocode_data = geocode_response.json()

        if geocode_data['status'] != 'OK':
            current_app.logger.error(f"Error geocoding zip code {zip_code}: {geocode_data.get('error_message', 'Unknown error')}")
            return jsonify({'error': f'Failed to geocode ZIP code {zip_code}'}), 400

        location = geocode_data['results'][0]['geometry']['location']
        latitude = location['lat']
        longitude = location['lng']
        current_app.logger.info(f"Geocoded zip code {zip_code} to Lat: {latitude}, Lng: {longitude}")
    except requests.exceptions.RequestException as e:
        current_app.logger.error(f"Error during geocoding request: {e}")
        return jsonify({'error': 'Geocoding request failed'}), 500
    except IndexError:
        current_app.logger.error(f"Could not find location data for zip code {zip_code}.")
        return jsonify({'error': 'Invalid ZIP code'}), 400

    # --- Step 2: Use Nearby Search to find pharmacies ---
    places_url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
    params = {
        'location': f"{latitude},{longitude}",
        'radius': radius_meters,
        'type': 'pharmacy',
        'key': GOOGLE_API_KEY
    }

    try:
        places_response = requests.get(places_url, params=params)
        places_response.raise_for_status()
        places_data = places_response.json()

        if places_data['status'] == 'ZERO_RESULTS':
            current_app.logger.info(f"No pharmacies found within {radius_miles} miles of {zip_code}.")
            return jsonify({'pharmacies': []})
        elif places_data['status'] != 'OK':
            current_app.logger.error(f"Error during nearby search: {places_data.get('error_message', 'Unknown error')}")
            return jsonify({'error': 'Nearby search failed'}), 500

        # --- Step 3: Extract pharmacy information ---
        import math

        def haversine(lat1, lon1, lat2, lon2):
            """Calculate distance (in meters) between two lat/lng coordinates."""
            R = 6371000  # Earth radius in meters
            phi1, phi2 = math.radians(lat1), math.radians(lat2)
            d_phi = math.radians(lat2 - lat1)
            d_lambda = math.radians(lon2 - lon1)
    
            a = math.sin(d_phi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2)**2
            return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))

        # --- Extract and sort pharmacies ---
        pharmacies = []
        for place in places_data.get('results', []):
            lat = place['geometry']['location']['lat']
            lng = place['geometry']['location']['lng']
            distance = haversine(latitude, longitude, lat, lng)

            open_now = place.get('opening_hours', {}).get('open_now') if 'opening_hours' in place else None

            pharmacy = {
                'name': place.get('name'),
                'address': place.get('vicinity'),
                'rating': place.get('rating'),
                'user_ratings_total': place.get('user_ratings_total'),
                'open_now': open_now,
                'place_id': place.get('place_id'),
                'distance_meters': round(distance, 1)
            }
            pharmacies.append(pharmacy)

        # --- Sort: open first by distance, then closed by distance ---
        open_pharmacies = sorted([p for p in pharmacies if p['open_now']], key=lambda x: x['distance_meters'])
        closed_pharmacies = sorted([p for p in pharmacies if not p['open_now']], key=lambda x: x['distance_meters'])
        pharmacies_sorted = open_pharmacies + closed_pharmacies

        return jsonify({'pharmacies': pharmacies_sorted})

    except requests.exceptions.RequestException as e:
        current_app.logger.error(f"Error during nearby search request: {e}")
        return jsonify({'error': 'Nearby search request failed'}), 500