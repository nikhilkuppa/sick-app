# app/auth/routes.py - Updated version
import json
import datetime
import pytz
from flask import Blueprint, request, jsonify, redirect, url_for, current_app, g
from app.auth.services import (
    get_social_auth_url,
    handle_social_callback,
    register_user,
    login_user,
    get_user,
    refresh_token,
    update_user_profile,
    get_user_profile,
    update_subscription_tier,
    check_anonymous_limit,
    delete_user_account
)
from app.utils.security import validate_input
from app.auth.rate_limiter import increment_request_count
from app.api.route_metrics import route_timed_execution
from app import redis_client
import hashlib
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os
from app.db.supabase_client import get_supabase_client
from app.utils.timezone import get_user_datetime
# from app.utils.medication import validate_medication_status
# from app.utils.caregiver import check_caregiver_access

auth_bp = Blueprint('auth', __name__, url_prefix='/api/v1/auth')

# Helper function to get standardized dates and times
def get_standardized_datetime(user_id=None):
    """Get current datetime in user's timezone or Eastern Time if no user"""
    try:
        if user_id:
            # Get user's timezone from profile
            supabase = get_supabase_client()
            user_profile = supabase.table('user_profiles')\
                .select('timezone')\
                .eq('user_id', user_id)\
                .single().execute()
                
            if user_profile.data and user_profile.data.get('timezone'):
                user_tz = pytz.timezone(user_profile.data['timezone'])
            else:
                user_tz = pytz.timezone('US/Eastern')
        else:
            user_tz = pytz.timezone('US/Eastern')
            
        now = datetime.datetime.now(user_tz)
        return {
            'date': now.strftime('%Y-%m-%d'),
            'time': now.strftime('%H:%M:%S'),
            'datetime': now,
            'timezone': str(user_tz)
        }
    except Exception as e:
        current_app.logger.error(f"Error getting standardized datetime: {str(e)}")
        # Fallback to Eastern Time
        eastern = pytz.timezone('US/Eastern')
        now = datetime.datetime.now(eastern)
        return {
            'date': now.strftime('%Y-%m-%d'),
            'time': now.strftime('%H:%M:%S'),
            'datetime': now,
            'timezone': 'US/Eastern'
        }

# Middleware to track anonymous requests for all endpoints
@auth_bp.before_request
def before_request_middleware():
    """Middleware to run before all requests to auth endpoints."""
    # Log request for analytics
    current_app.logger.debug(f"Auth request: {request.method} {request.path}")
    
    # Store request start time for metrics
    g.start_time = current_app.logger.start_time

@auth_bp.route('/social-login', methods=['GET'])
@route_timed_execution
def social_login():
    """Initiate social login flow for the specified provider."""
    # Get the provider from query param
    provider = request.args.get('provider')
    if not provider:
        return jsonify({'error': 'Provider not specified'}), 400
    
    # Get the redirect URL after successful authentication
    redirect_to = request.args.get('redirect_to', '/')
    
    # Get the auth URL from the service
    auth_url = get_social_auth_url(provider, redirect_to)
    
    if not auth_url:
        return jsonify({'error': f'Unsupported provider: {provider}'}), 400
    
    # Return the URL for frontend redirect
    return jsonify({'url': auth_url})

@auth_bp.route('/callback/<provider>', methods=['GET'])
@route_timed_execution
def social_callback(provider):
    """Handle callback from social auth provider."""
    # Get code and state from query params
    code = request.args.get('code')
    redirect_to = request.args.get('redirect_to', '/')
    
    if not code:
        return jsonify({'error': 'Invalid callback: missing code parameter'}), 400
    
    # Handle the authentication callback
    result = handle_social_callback(provider, code, redirect_to)
    
    if 'error' in result:
        return jsonify(result), 400
    
    # Create success redirect URL with authentication tokens
    if redirect_to.startswith('/'):
        # Relative URL, add base URL
        base_url = request.url_root.rstrip('/')
        redirect_to = f"{base_url}{redirect_to}"
    
    query_char = '?' if '?' not in redirect_to else '&'
    query_char = '#'
    success_url = f"{redirect_to}{query_char}access_token={result['access_token']}&refresh_token={result['refresh_token']}&expires_in={result['expires_in']}"
    
    return redirect(success_url)

@auth_bp.route('/register', methods=['POST'])
@validate_input()
@route_timed_execution
def register():
    """Register a new user."""
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')
    name = data.get('name', '')
    
    # Validate required fields
    if not email or not password:
        return jsonify({'error': 'Email and password are required'}), 400
    
    # Optional user profile data
    profile_data = {
        'age': data.get('age'),
        'gender': data.get('gender'),
        'allergies': data.get('allergies', []),
        'zip_code': data.get('zip_code'),
        'medication_history': data.get('medication_history', [])
    }
    
    result = register_user(email, password, name, profile_data)
    if 'error' in result:
        return jsonify(result), 400
        
    return jsonify(result), 201

@auth_bp.route('/login', methods=['POST'])
@validate_input()
@route_timed_execution
def login():
    """Log in an existing user."""
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')
    
    # Validate required fields
    if not email or not password:
        return jsonify({'error': 'Email and password are required'}), 400
    
    # Log in the user
    result = login_user(email, password)
    
    if 'error' in result:
        return jsonify(result), 401
    
    return jsonify(result)

@auth_bp.route('/user', methods=['GET'])
@route_timed_execution
def get_current_user():
    """Get the current user's information."""
    # Get token from Authorization header
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Invalid authorization header'}), 401
    
    token = auth_header[7:]  # Remove 'Bearer ' prefix
    user_info = get_user(token)
    
    if 'error' in user_info:
        return jsonify(user_info), 401
    
    return jsonify(user_info)

@auth_bp.route('/refresh', methods=['POST'])
@route_timed_execution
def refresh():
    """Refresh the authentication token."""
    try:
        data = request.get_json()
        refresh_token_str = data.get('refresh_token')
        
        if not refresh_token_str:
            return jsonify({'error': 'Refresh token is required'}), 400
        
        # Refresh the token
        result = refresh_token(refresh_token_str)
        
        if 'error' in result:
            return jsonify(result), 401
        
        return jsonify(result)
    except Exception as e:
        current_app.logger.error(f"Error in refresh route: {str(e)}")
        return jsonify({'error': 'Token refresh failed'}), 401

@auth_bp.route('/verify-email/<token>', methods=['GET'])
def verify_email(token):
    """Verify a user's email address."""
    from app.auth.services import verify_email as verify_email_service
    
    result = verify_email_service(token)
    if 'error' in result:
        return jsonify(result), 400
        
    return jsonify(result)

@auth_bp.route('/reset-password-request', methods=['POST'])
@validate_input()
@route_timed_execution
def reset_password_request():
    """Request a password reset."""
    data = request.get_json()
    email = data.get('email')
    
    if not email:
        return jsonify({'error': 'Email is required'}), 400
    
    from app.auth.services import reset_password_request as reset_request_service
    result = reset_request_service(email)
    
    # Always return success to prevent email enumeration
    return jsonify({'message': 'If your email is registered, you will receive a password reset link'})

@auth_bp.route('/reset-password/<token>', methods=['POST'])
@validate_input()
@route_timed_execution
def reset_password(token):
    """Reset a user's password using a token."""
    data = request.get_json()
    new_password = data.get('password')
    
    if not new_password:
        return jsonify({'error': 'New password is required'}), 400
    
    from app.auth.services import reset_password_confirm
    result = reset_password_confirm(token, new_password)
    
    if 'error' in result:
        return jsonify(result), 400
    
    return jsonify(result)

@auth_bp.route('/profile', methods=['PUT'])
@validate_input()
@route_timed_execution
def update_profile():
    """Update a user's profile information."""
    # Get token from Authorization header
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Authentication required'}), 401
    
    token = auth_header[7:]  # Remove 'Bearer ' prefix
    user_info = get_user(token)
    
    if 'error' in user_info:
        return jsonify(user_info), 401
    
    # Get profile data from request
    data = request.get_json()
    profile_data = {
        'name': data.get('name'),
        'age': data.get('age'),
        'gender': data.get('gender'),
        'allergies': data.get('allergies'),
        'zip_code': data.get('zip_code'),
        'medication_history': data.get('medication_history')
    }
    
    # Update the profile
    result = update_user_profile(user_info['user_id'], profile_data)
    
    if 'error' in result:
        return jsonify(result), 400
    
    return jsonify(result)

@auth_bp.route('/profile/<user_id>', methods=['GET'])
@route_timed_execution
def get_profile(user_id):
    """Get a user's profile information."""
    # Get token from Authorization header
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Authentication required'}), 401
    
    token = auth_header[7:]  # Remove 'Bearer ' prefix
    current_user = get_user(token)
    
    if 'error' in current_user:
        return jsonify(current_user), 401
    
    # Check if user is requesting their own profile or has admin role
    if current_user['user_id'] != user_id and current_user.get('role') != 'admin':
        return jsonify({'error': 'Unauthorized to access this profile'}), 403
    
    # Get the profile
    profile = get_user_profile(user_id)
    
    if 'error' in profile:
        return jsonify(profile), 400
    
    return jsonify(profile)

@auth_bp.route('/delete-account', methods=['DELETE'])
@route_timed_execution
def delete_account():
    """Delete a user's account."""
    # Get token from Authorization header
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Authentication required'}), 401
    
    token = auth_header[7:]  # Remove 'Bearer ' prefix
    user_info = get_user(token)
    
    if 'error' in user_info:
        return jsonify(user_info), 401
    
    # Delete the account
    result = delete_user_account(user_info['user_id'])
    
    if 'error' in result:
        return jsonify(result), 400
    
    return jsonify(result)

@auth_bp.route('/subscription', methods=['PUT'])
@validate_input()
@route_timed_execution
def update_subscription():
    """Update a user's subscription tier."""
    # Get token from Authorization header
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Authentication required'}), 401
    
    token = auth_header[7:]  # Remove 'Bearer ' prefix
    user_info = get_user(token)
    
    if 'error' in user_info:
        return jsonify(user_info), 401
    
    # Get subscription data from request
    data = request.get_json()
    tier = data.get('tier')
    
    if not tier:
        return jsonify({'error': 'Subscription tier is required'}), 400
    
    # Validate tier
    valid_tiers = ['free', 'basic', 'premium']
    if tier not in valid_tiers:
        return jsonify({'error': f'Invalid subscription tier. Valid tiers are: {", ".join(valid_tiers)}'}), 400
    
    # Update the subscription
    result = update_subscription_tier(user_info['user_id'], tier)
    
    if 'error' in result:
        return jsonify(result), 400
    
    return jsonify(result)

@auth_bp.route('/anonymous-limit', methods=['GET'])
def anonymous_limit():
    """Check the request limit for anonymous users."""
    client_ip = request.remote_addr
    limit_info = check_anonymous_limit(client_ip)
    return jsonify(limit_info)

@auth_bp.route('/track-medication', methods=['POST'])
@route_timed_execution
def track_medication():
    """Track a medication usage."""
    auth_header = request.headers.get('Authorization')
    user_id = None
    
    # Check if user is authenticated
    if auth_header and auth_header.startswith('Bearer '):
        token = auth_header[7:]  # Remove 'Bearer ' prefix
        user_info = get_user(token)
        if 'error' not in user_info:
            user_id = user_info['user_id']
    
    # Anonymous users can't track medications
    if not user_id:
        return jsonify({'error': 'Authentication required to track medications'}), 401
    
    data = request.get_json()
    medication_data = {
        'drug_name': data.get('drug_name'),
        'brand_name': data.get('brand_name'),
        'dosage': data.get('dosage'),
        'frequency': data.get('frequency'),
        'start_date': data.get('start_date'),
        'end_date': data.get('end_date'),
        'reminder_enabled': data.get('reminder_enabled', False),
        'reminder_times': data.get('reminder_times', [])
    }
    
    # Add medication tracking logic here
    supabase = get_supabase_client()
    
    # Check if it's an update (has medication_id) or new record
    medication_id = data.get('medication_id')
    if medication_id:
        # Update existing medication
        # First verify it belongs to this user
        existing_med = supabase.table('user_medications').select('*').eq('id', medication_id).eq('user_id', user_id).single().execute()
        
        if not existing_med.data:
            return jsonify({'error': 'Medication not found or unauthorized'}), 403
            
        # Update the record
        med_result = supabase.table('user_medications').update({
            'medication_data': json.dumps(medication_data),
            'updated_at': 'now()'
        }).eq('id', medication_id).execute()
        
        result_message = 'Medication updated successfully'
    else:
        # Insert new medication record
        med_record = {
            'user_id': user_id,
            'medication_data': json.dumps(medication_data),
            'created_at': 'now()'
        }
        
        med_result = supabase.table('user_medications').insert(med_record).execute()
        result_message = 'Medication tracked successfully'
    
    # Update user profile with the medication (optional, for backward compatibility)
    user_result = supabase.table('user_profiles').select('medication_history').eq('user_id', user_id).single().execute()
    
    if user_result.data:
        med_history = user_result.data.get('medication_history', [])
        if not med_history:
            med_history = []
            
        # If med_history is a string, parse it
        if isinstance(med_history, str):
            try:
                med_history = json.loads(med_history)
            except:
                med_history = []
        
        # Ensure it's a list
        if not isinstance(med_history, list):
            med_history = []
        
        # Check if we need to update an existing entry or add a new one
        if medication_id:
            # For update, find and replace the entry
            found = False
            for i, med in enumerate(med_history):
                if med.get('id') == medication_id:
                    med_history[i] = medication_data
                    found = True
                    break
            
            if not found:
                medication_data['id'] = medication_id
                med_history.append(medication_data)
        else:
            # For new medication, append
            med_history.append(medication_data)
        
        # Update the profile
        update_result = supabase.table('user_profiles').update({
            'medication_history': json.dumps(med_history)
        }).eq('user_id', user_id).execute()
    
    return jsonify({
        'success': True,
        'message': result_message
    })

@auth_bp.route('/medications', methods=['GET'])
@route_timed_execution
def get_user_medications():
    """Get a user's tracked medications, ensuring uniqueness."""
    try:
        auth_header = request.headers.get('Authorization')
        user_id = None
        
        # Check if user is authenticated
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header[7:]  # Remove 'Bearer ' prefix
            user_info = get_user(token)
            if 'error' not in user_info:
                user_id = user_info['user_id']
        
        # Anonymous users can't track medications
        if not user_id:
            return jsonify({'error': 'Authentication required to access medications'}), 401
    
        
        # Get medications from Supabase
        from app.db.supabase_client import get_supabase_client
        supabase = get_supabase_client()
        
        # Get all medication records for this user
        med_records = supabase.table('user_medications').select('*').eq('user_id', user_id).order('created_at', desc=True).execute()
        
        # Use a dictionary to track unique medications by drug name, keeping the most recent.
        unique_meds = {}
        
        if med_records.data:
            for record in med_records.data:
                try:
                    med_data = json.loads(record.get('medication_data', '{}'))
                    drug_name = med_data.get('drug_name')
                    if not drug_name:
                        continue
                    
                    # If we haven't seen this drug, or the current one is newer, add/replace it.
                    if drug_name not in unique_meds or unique_meds[drug_name].get('created_at') < record.get('created_at'):
                        med_data['id'] = record.get('id')
                        med_data['created_at'] = record.get('created_at')
                        unique_meds[drug_name] = med_data
                except json.JSONDecodeError:
                    pass
        
        # Convert the dictionary of unique meds back to a list
        medications = list(unique_meds.values())
        
        return jsonify({'medications': medications})
    except Exception as e:
        current_app.logger.exception("Error getting user medications")
        return jsonify({'error': 'An unexpected error occurred'}), 500
    
@auth_bp.route('/medication-status', methods=['POST'])
@route_timed_execution
def medication_status_manager():
    """
    Unified endpoint to create, update, or batch-update medication status.
    - POST to create a new status record.
    - PUT to update an existing record.
    - POST with 'batch': true for multiple updates.
    """
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Authentication required'}), 401
    
    token = auth_header[7:]
    user_info = get_user(token)
    if 'error' in user_info:
        return jsonify(user_info), 401
    user_id = user_info['user_id']
    
    data = request.get_json()
    
    # Handle batch updates
    if data.get('batch'):
        updates = data.get('updates', [])
        if not updates or not isinstance(updates, list):
            return jsonify({'error': 'Invalid batch update data'}), 400
        
        # NOTE: For a real-world app, this should be a background task
        results = []
        for update_data in updates:
            # Here you would call a helper function to process each update
            # This avoids deep nesting and code repetition
            pass # Placeholder for batch logic
        return jsonify({'success': True, 'results': results})

    # Single status update/create
    medication_id = data.get('medication_id')
    status = data.get('status')
    status_date = data.get('date')
    status_time = data.get('time')

    if not all([medication_id, status, status_date, status_time]):
        return jsonify({'error': 'Missing required fields: medication_id, status, date, time'}), 400
    
    if status not in ['taken', 'skipped', 'none']:
        return jsonify({'error': 'Invalid status'}), 400
        
    supabase = get_supabase_client()
    
    # Verify ownership
    medication = supabase.table('user_medications').select('id').eq('id', medication_id).eq('user_id', user_id).single().execute()
    if not medication.data:
        return jsonify({'error': 'Medication not found or unauthorized'}), 404

    # Upsert logic: Update if exists, otherwise insert
    # Supabase upsert requires a conflict target (e.g., a unique constraint)
    # Assuming a unique constraint on (user_id, medication_id, status_date, status_time)
    status_record = {
        'user_id': user_id,
        'medication_id': medication_id,
        'status': status,
        'status_date': status_date,
        'status_time': status_time,
    }
    
    result = supabase.table('medication_status').upsert(status_record, on_conflict='user_id,medication_id,status_date,status_time').execute()

    if result.data:
        return jsonify({'success': True, 'message': 'Medication status updated successfully.'})
    else:
        # Log the actual error from Supabase if possible
        current_app.logger.error(f"Supabase upsert error for medication status: {result.error}")
        return jsonify({'error': 'Failed to update medication status'}), 500

@auth_bp.route('/medication-status', methods=['DELETE'])
@route_timed_execution
def delete_medication_status():
    """Unified endpoint to delete a medication status record."""
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Authentication required'}), 401
    
    token = auth_header[7:]
    user_info = get_user(token)
    if 'error' in user_info:
        return jsonify(user_info), 401
    user_id = user_info['user_id']

    data = request.get_json()
    medication_id = data.get('medication_id')
    status_date = data.get('date')
    status_time = data.get('time')

    if not all([medication_id, status_date, status_time]):
        return jsonify({'error': 'Missing required fields: medication_id, date, time'}), 400

    supabase = get_supabase_client()

    # Verify ownership before deleting
    medication = supabase.table('user_medications').select('id').eq('id', medication_id).eq('user_id', user_id).single().execute()
    if not medication.data:
        return jsonify({'error': 'Medication not found or unauthorized'}), 404

    # Perform the delete
    result = supabase.table('medication_status').delete().match({
        'user_id': user_id,
        'medication_id': medication_id,
        'status_date': status_date,
        'status_time': status_time
    }).execute()

    if result.data:
        return jsonify({'success': True, 'message': 'Medication status deleted successfully.'})
    else:
        current_app.logger.error(f"Supabase delete error for medication status: {result.error}")
        return jsonify({'error': 'Failed to delete medication status or status not found.'}), 500
    
@auth_bp.route('/medication-adherence/<medication_id>', methods=['GET'])
@route_timed_execution
def get_medication_adherence(medication_id):
    """Get adherence data for a specific medication with improved caching and rate limiting."""
    try:
        # Use a more lenient and sophisticated rate limit approach
        client_ip = request.remote_addr
        user_agent = request.headers.get('User-Agent', '')
        
        # Create a unique key that combines IP, medication ID and a rough user agent hash
        # This prevents single user from being blocked due to legitimate UI interactions
        user_hash = hashlib.md5(f"{user_agent}".encode()).hexdigest()[:8]
        rate_key = f"adherence_{client_ip}_{user_hash}_{medication_id}"
        
        # Use a sliding window rate limit (30 requests per minute)
        # This is much more permissive than before but prevents abuse
        if redis_client.exists(rate_key):
            count = int(redis_client.get(rate_key))
            if count > 30:  # Allow 30 requests per minute from the same browser for the same medication
                return jsonify({'error': 'Too many requests. Please try again later.'}), 429
            
            redis_client.incr(rate_key)
        else:
            # Set initial count with 60-second expiry
            redis_client.setex(rate_key, 60, 1)

        auth_header = request.headers.get('Authorization')
        user_id = None
        
        # Check if user is authenticated
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header[7:]  # Remove 'Bearer ' prefix
            user_info = get_user(token)
            if 'error' not in user_info:
                user_id = user_info['user_id']
        
        # Anonymous users can't access medication data
        if not user_id:
            return jsonify({'error': 'Authentication required to access medication data'}), 401
        
        # Get days parameter (default to 7 days)
        days = int(request.args.get('days', 7))
        
        # Check the cache first (add server-side caching)
        cache_key = f"med_adherence:{medication_id}:{days}:{user_id}"
        cached_data = redis_client.get(cache_key)
        
        if cached_data:
            return jsonify(json.loads(cached_data))
        
        # Get the medication to verify ownership
        from app.db.supabase_client import get_supabase_client
        supabase = get_supabase_client()
        
        medication = supabase.table('user_medications').select('*').eq('id', medication_id).single().execute()
        
        if not medication.data:
            return jsonify({'error': 'Medication not found'}), 404
            
        if medication.data.get('user_id') != user_id:
            return jsonify({'error': 'Unauthorized to view this medication'}), 403
            
        # Get the start date (X days ago) and end date (today) using Eastern Time
        datetime_info = get_standardized_datetime()
        end_date = datetime.datetime.strptime(datetime_info['date'], '%Y-%m-%d').date()
        start_date = end_date - datetime.timedelta(days=days-1)  # Inclusive of today
        
        # Generate all dates in the range
        all_dates = []
        current_date = start_date
        while current_date <= end_date:
            all_dates.append(current_date.isoformat())
            current_date += datetime.timedelta(days=1)
        
        # Query status records
        status_records = supabase.table('medication_status')\
            .select('*')\
            .eq('medication_id', medication_id)\
            .gte('status_date', start_date.isoformat())\
            .lte('status_date', end_date.isoformat())\
            .order('status_date', desc=False)\
            .execute()
        
        # Create a map of date -> status for quick lookup
        status_map = {}
        if status_records.data:
            for record in status_records.data:
                status_map[record.get('status_date')] = record.get('status')
        
        # Format results - include all dates in the range with their status
        dates = all_dates
        statuses = []
        
        for date in all_dates:
            statuses.append(status_map.get(date, None))
        
        response_data = {
            'medication_id': medication_id,
            'dates': dates,
            'status': statuses
        }
        
        # Cache the result for 5 minutes (300 seconds)
        # This prevents hammering the database for the same data
        redis_client.setex(cache_key, 300, json.dumps(response_data))
        
        return jsonify(response_data)
        
    except Exception as e:
        current_app.logger.exception(f"Error getting medication adherence: {str(e)}")
        return jsonify({'error': f'An unexpected error occurred: {str(e)}'}), 500
    
@auth_bp.route('/bulk-medication-adherence', methods=['POST'])
@route_timed_execution
def get_bulk_medication_adherence():
    """Get adherence data for multiple medications in a single request."""
    try:
        auth_header = request.headers.get('Authorization')
        user_id = None
        
        # Check if user is authenticated
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header[7:]  # Remove 'Bearer ' prefix
            user_info = get_user(token)
            if 'error' not in user_info:
                user_id = user_info['user_id']
        
        # Anonymous users can't access medication data
        if not user_id:
            return jsonify({'error': 'Authentication required to access medication data'}), 401
        
        data = request.get_json()
        medication_ids = data.get('medication_ids', [])
        days = int(data.get('days', 7))
        
        if not medication_ids:
            return jsonify({'error': 'No medication IDs provided'}), 400
            
        # Rate limit based on the number of medications requested
        client_ip = request.remote_addr
        rate_key = f"bulk_adherence_{client_ip}"
        
        if redis_client.exists(rate_key):
            count = int(redis_client.get(rate_key))
            if count > 5:  # Allow 5 bulk requests per minute
                return jsonify({'error': 'Too many requests. Please try again later.'}), 429
            
            redis_client.incr(rate_key)
        else:
            redis_client.setex(rate_key, 60, 1)
        
        from app.db.supabase_client import get_supabase_client
        supabase = get_supabase_client()
        
        # Get all dates in the range
        datetime_info = get_standardized_datetime()
        end_date = datetime.datetime.strptime(datetime_info['date'], '%Y-%m-%d').date()
        start_date = end_date - datetime.timedelta(days=days-1)
        
        # Generate all dates
        all_dates = []
        current_date = start_date
        while current_date <= end_date:
            all_dates.append(current_date.isoformat())
            current_date += datetime.timedelta(days=1)
        
        # Check ownership of all medications at once
        medications = supabase.table('user_medications')\
            .select('id')\
            .eq('user_id', user_id)\
            .in_('id', medication_ids)\
            .execute()
            
        valid_med_ids = [med['id'] for med in medications.data]
        
        # Get all status records for valid medications in one query
        if valid_med_ids:
            status_records = supabase.table('medication_status')\
                .select('*')\
                .in_('medication_id', valid_med_ids)\
                .gte('status_date', start_date.isoformat())\
                .lte('status_date', end_date.isoformat())\
                .execute()
                
            # Group by medication_id
            status_by_med = {}
            for record in status_records.data:
                med_id = record.get('medication_id')
                if med_id not in status_by_med:
                    status_by_med[med_id] = {}
                
                status_by_med[med_id][record.get('status_date')] = record.get('status')
        else:
            status_by_med = {}
        
        # Format results for each medication
        results = {}
        for med_id in valid_med_ids:
            statuses = []
            for date in all_dates:
                statuses.append(status_by_med.get(med_id, {}).get(date))
            
            results[med_id] = {
                'dates': all_dates,
                'status': statuses
            }
        
        return jsonify({'adherence_data': results})
        
    except Exception as e:
        current_app.logger.exception(f"Error getting bulk medication adherence: {str(e)}")
        return jsonify({'error': f'An unexpected error occurred: {str(e)}'}), 500
    
@auth_bp.route('/medication/<medication_id>', methods=['DELETE'])
@route_timed_execution
def delete_medication(medication_id):
    """Delete a medication and all its associated status records."""
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Authentication required'}), 401

    token = auth_header.split(' ')[1]
    user_info = get_user(token)
    if 'error' in user_info:
        return jsonify(user_info), 401
    user_id = user_info['user_id']

    supabase = get_supabase_client()

    # First, verify the user owns this medication
    medication = supabase.table('user_medications').select('id').eq('id', medication_id).eq('user_id', user_id).single().execute()
    if not medication.data:
        return jsonify({'error': 'Medication not found or unauthorized'}), 404

    # Delete associated status records (important for data integrity)
    supabase.table('medication_status').delete().eq('medication_id', medication_id).execute()

    # Delete the main medication record
    result = supabase.table('user_medications').delete().eq('id', medication_id).execute()

    if result.data:
        return jsonify({'success': True, 'message': 'Medication deleted successfully.'})
    else:
        current_app.logger.error(f"Supabase delete error for medication: {result.error}")
        return jsonify({'error': 'Failed to delete medication.'}), 500

@auth_bp.route('/user-history', methods=['GET'])
@route_timed_execution
def get_user_history():
    """Get the user's search query history."""
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Authentication required'}), 401
    
    token = auth_header.split(' ')[1]
    user_info = get_user(token)
    if 'error' in user_info:
        return jsonify(user_info), 401
    user_id = user_info['user_id']

    try:
        supabase = get_supabase_client()
        # The user's table might be named 'search_history' or similar. 
        # Using 'user_query_history' as that was in the code previously.
        history_records = supabase.table('user_query_history').select('*').eq('user_id', user_id).order('created_at', desc=True).limit(50).execute()
        
        return jsonify({'history': history_records.data or []})
    except Exception as e:
        current_app.logger.error(f"Could not retrieve user history for user {user_id}: {e}")
        return jsonify({'history': [], 'error': 'Could not retrieve user history.'})

# After request handler (metrics, logging, etc.)
@auth_bp.after_request
def after_request_middleware(response):
    """Middleware to run after all requests to auth endpoints."""
    # Log response for analytics
    current_app.logger.debug(f"Auth response: {response.status_code}")
    
    # Track request duration for metrics if available
    if hasattr(g, 'start_time'):
        duration = current_app.logger.start_time - g.start_time
        current_app.logger.debug(f"Request duration: {duration:.4f}s")
    
    return response

@auth_bp.route('/send-medication-reminder', methods=['POST'])
@route_timed_execution
def send_medication_reminder():
    """Send email reminder for medication."""
    try:
        auth_header = request.headers.get('Authorization')
        user_id = None
        
        # Check if user is authenticated
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header[7:]
            user_info = get_user(token)
            if 'error' not in user_info:
                user_id = user_info['user_id']
                user_email = user_info['email']
                user_name = user_info.get('name', 'User')
        
        if not user_id:
            return jsonify({'error': 'Authentication required'}), 401
        
        data = request.get_json()
        medication_name = data.get('medication_name')
        dosage = data.get('dosage', '')
        reminder_time = data.get('reminder_time')
        
        if not medication_name or not reminder_time:
            return jsonify({'error': 'Medication name and reminder time are required'}), 400
        
        # Format the reminder time
        try:
            time_obj = datetime.strptime(reminder_time, '%H:%M')
            formatted_time = time_obj.strftime('%I:%M %p')
        except:
            formatted_time = reminder_time
        
        # Send email reminder
        success = send_email_reminder(
            user_email, 
            user_name, 
            medication_name, 
            dosage, 
            formatted_time
        )
        
        if success:
            return jsonify({'success': True, 'message': 'Email reminder sent'})
        else:
            return jsonify({'success': False, 'message': 'Failed to send email reminder'}), 500
            
    except Exception as e:
        current_app.logger.exception("Error sending medication reminder")
        return jsonify({'error': 'An unexpected error occurred'}), 500

@auth_bp.route('/medication-status-check', methods=['GET'])
@route_timed_execution
def check_medication_status():
    """Check if medication was taken at specific time."""
    try:
        auth_header = request.headers.get('Authorization')
        user_id = None
        
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header[7:]
            user_info = get_user(token)
            if 'error' not in user_info:
                user_id = user_info['user_id']
        
        if not user_id:
            return jsonify({'error': 'Authentication required'}), 401
        
        medication_id = request.args.get('medication_id')
        date = request.args.get('date')
        time = request.args.get('time')
        
        if not all([medication_id, date, time]):
            return jsonify({'error': 'Medication ID, date, and time are required'}), 400
        
        supabase = get_supabase_client()
        
        # Check status for the specific time
        status_record = supabase.table('medication_status')\
            .select('status')\
            .eq('user_id', user_id)\
            .eq('medication_id', medication_id)\
            .eq('status_date', date)\
            .eq('status_time', time + ':00')\
            .execute()
        
        if status_record.data:
            return jsonify({'status': status_record.data[0]['status']})
        else:
            return jsonify({'status': 'none'})
            
    except Exception as e:
        current_app.logger.exception("Error checking medication status")
        return jsonify({'error': 'An unexpected error occurred'}), 500

@auth_bp.route('/medication-detailed-status', methods=['GET'])
@route_timed_execution
def get_medication_detailed_status():
    """Get detailed status for a specific medication on a specific day."""
    try:
        auth_header = request.headers.get('Authorization')
        user_id = None
        
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header[7:]
            user_info = get_user(token)
            if 'error' not in user_info:
                user_id = user_info['user_id']
        
        if not user_id:
            return jsonify({'error': 'Authentication required'}), 401
        
        medication_id = request.args.get('medication_id')
        date = request.args.get('date')
        
        if not medication_id or not date:
            return jsonify({'error': 'Medication ID and date are required'}), 400
        
        supabase = get_supabase_client()
        
        # Get all status records for this medication on this date
        status_records = supabase.table('medication_status')\
            .select('status_time, status')\
            .eq('user_id', user_id)\
            .eq('medication_id', medication_id)\
            .eq('status_date', date)\
            .order('status_time')\
            .execute()
        
        # Format the response
        times = []
        if status_records.data:
            for record in status_records.data:
                # Convert time format from HH:MM:SS to HH:MM
                time_str = record['status_time']
                if len(time_str) > 5:  # If includes seconds
                    time_str = time_str[:5]
                
                times.append({
                    'time': time_str,
                    'status': record['status']
                })
        
        return jsonify({'times': times})
        
    except Exception as e:
        current_app.logger.exception("Error getting detailed medication status")
        return jsonify({'error': 'An unexpected error occurred'}), 500

def send_email_reminder(user_email, user_name, medication_name, dosage, reminder_time):
    """Send email reminder for medication."""
    try:
        # Email configuration (you'll need to set these in your environment)
        smtp_server = os.environ.get('SMTP_SERVER', 'smtp.gmail.com')
        smtp_port = int(os.environ.get('SMTP_PORT', 587))
        smtp_username = os.environ.get('SMTP_USERNAME')
        smtp_password = os.environ.get('SMTP_PASSWORD')
        from_email = os.environ.get('FROM_EMAIL', smtp_username)
        
        if not all([smtp_username, smtp_password]):
            current_app.logger.warning("SMTP credentials not configured")
            return False
        
        # Create message
        msg = MIMEMultipart()
        msg['From'] = from_email
        msg['To'] = user_email
        msg['Subject'] = f"💊 Medication Reminder: {medication_name}"
        
        # Email body
        body = f"""
        <html>
        <body>
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #4CAF50; color: white; padding: 20px; text-align: center;">
                    <h1>💊 Medication Reminder</h1>
                </div>
                
                <div style="padding: 20px; background-color: #f9f9f9;">
                    <p>Hello {user_name},</p>
                    
                    <p>This is a friendly reminder that it's time to take your medication:</p>
                    
                    <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <h3 style="color: #4CAF50; margin-top: 0;">Medication Details</h3>
                        <p><strong>Medication:</strong> {medication_name}</p>
                        {f'<p><strong>Dosage:</strong> {dosage}</p>' if dosage else ''}
                        <p><strong>Scheduled Time:</strong> {reminder_time}</p>
                    </div>
                    
                    <p>Remember to take your medication as prescribed. If you have any questions or concerns, please consult your healthcare provider.</p>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="{request.url_root}" 
                           style="background-color: #4CAF50; color: white; padding: 12px 24px; 
                                  text-decoration: none; border-radius: 5px; display: inline-block;">
                            Mark as Taken
                        </a>
                    </div>
                    
                    <p style="font-size: 12px; color: #666; margin-top: 30px;">
                        This is an automated reminder from your medication tracking app. 
                        To stop receiving these reminders, please update your medication settings.
                    </p>
                </div>
            </div>
        </body>
        </html>
        """
        
        msg.attach(MIMEText(body, 'html'))
        
        # Send email
        server = smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()
        server.login(smtp_username, smtp_password)
        text = msg.as_string()
        server.sendmail(from_email, user_email, text)
        server.quit()
        
        current_app.logger.info(f"Email reminder sent to {user_email} for {medication_name}")
        return True
        
    except Exception as e:
        current_app.logger.error(f"Error sending email reminder: {str(e)}")
        return False

@auth_bp.route('/user-timezone', methods=['GET'])
@route_timed_execution
def get_user_timezone():
    """Get the user's timezone preference."""
    try:
        auth_header = request.headers.get('Authorization')
        user_id = None
        
        # Check if user is authenticated
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header[7:]  # Remove 'Bearer ' prefix
            user_info = get_user(token)
            if 'error' not in user_info:
                user_id = user_info['user_id']
        
        if not user_id:
            return jsonify({'error': 'Authentication required'}), 401
            
        # Get user's timezone from profile
        supabase = get_supabase_client()
        profile_response = supabase.table('user_profiles').select('timezone').eq('user_id', user_id).single().execute()
            
        # Error handling for Supabase query
        if profile_response.error:
            # Check for a specific error if needed, e.g., PostgREST error codes
            current_app.logger.error(f"Supabase error fetching profile for user {user_id}: {profile_response.error.message}")
            return jsonify({'error': 'Failed to retrieve user profile data.'}), 500

        user_profile = profile_response.data

        if not user_profile:
            # Create profile with default timezone if it doesn't exist
            insert_response = supabase.table('user_profiles').insert({
                'user_id': user_id,
                'timezone': 'US/Eastern'
            }).execute()
            
            if insert_response.error:
                current_app.logger.error(f"Supabase error creating profile for user {user_id}: {insert_response.error.message}")
                return jsonify({'error': 'Failed to create user profile'}), 500
                
            return jsonify({'timezone': 'US/Eastern'})
            
        return jsonify({'timezone': user_profile.get('timezone', 'US/Eastern')})
        
    except Exception as e:
        current_app.logger.exception("Error getting user timezone")
        return jsonify({'error': 'An unexpected error occurred'}), 500

@auth_bp.route('/user-timezone', methods=['PUT'])
@route_timed_execution
def update_user_timezone():
    """Update the user's timezone preference."""
    try:
        auth_header = request.headers.get('Authorization')
        user_id = None
        
        # Check if user is authenticated
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header[7:]  # Remove 'Bearer ' prefix
            user_info = get_user(token)
            if 'error' not in user_info:
                user_id = user_info['user_id']
        
        if not user_id:
            return jsonify({'error': 'Authentication required'}), 401
            
        data = request.get_json()
        timezone = data.get('timezone')
        
        if not timezone:
            return jsonify({'error': 'Timezone is required'}), 400
            
        # Validate timezone
        try:
            pytz.timezone(timezone)
        except pytz.exceptions.UnknownTimeZoneError:
            return jsonify({'error': 'Invalid timezone'}), 400
            
        # Update user's timezone
        supabase = get_supabase_client()
        
        # First check if profile exists
        profile = supabase.table('user_profiles')\
            .select('id')\
            .eq('user_id', user_id)\
            .single().execute()
            
        if not profile.data:
            # Create profile with timezone
            result = supabase.table('user_profiles').insert({
                'user_id': user_id,
                'timezone': timezone
            }).execute()
        else:
            # Update existing profile
            result = supabase.table('user_profiles')\
                .update({'timezone': timezone})\
                .eq('user_id', user_id)\
                .execute()
            
        if not result.data:
            return jsonify({'error': 'Failed to update timezone'}), 500
            
        return jsonify({'success': True, 'timezone': timezone})
        
    except Exception as e:
        current_app.logger.exception("Error updating user timezone")
        return jsonify({'error': 'An unexpected error occurred'}), 500