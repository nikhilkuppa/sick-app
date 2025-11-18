# app/db/supabase_client.py
import logging
from functools import wraps
import time
import os
from supabase import create_client
from app.config import active_config

# Initialize logger
logger = logging.getLogger(__name__)

# Connection pool for Supabase clients
_supabase_clients = {}

def get_supabase_client():
    """
    Get a Supabase client from the connection pool or create a new one.
    
    Returns:
        Client: Supabase client instance
    """
    # Use PID as key to ensure process isolation
    pid = os.getpid()
    
    if pid not in _supabase_clients:
        logger.info(f"Creating new Supabase client for process {pid}")
        
        # Validate configuration
        if not active_config.SUPABASE_URL or not active_config.SUPABASE_SERVICE_ROLE_KEY:
            logger.error("Supabase configuration missing. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
            raise ValueError("Supabase configuration missing")
        
        # Create client with service role key
        _supabase_clients[pid] = create_client(
            active_config.SUPABASE_URL, 
            active_config.SUPABASE_SERVICE_ROLE_KEY
        )
    
    return _supabase_clients[pid]

def with_error_handling(func):
    """
    Decorator to handle Supabase errors consistently.
    
    Args:
        func: Function to decorate
        
    Returns:
        function: Decorated function
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                return func(*args, **kwargs)
            except Exception as e:
                retry_count += 1
                logger.warning(f"Supabase operation failed (attempt {retry_count}/{max_retries}): {str(e)}")
                
                if retry_count >= max_retries:
                    logger.error(f"Supabase operation failed after {max_retries} attempts: {str(e)}")
                    raise
                
                # Exponential backoff
                time.sleep(0.5 * (2 ** retry_count))
    
    return wrapper

@with_error_handling
def insert_recommendation_job(job_data):
    """
    Insert a new recommendation job record.
    
    Args:
        job_data (dict): Job data including job_id, user_id, user_query, etc.
        
    Returns:
        dict: Response data
    """
    supabase = get_supabase_client()
    
    response = supabase.table('recommendations').insert(job_data).execute()
    
    if not response.data:
        logger.error(f"Failed to insert job {job_data.get('job_id')}")
        raise Exception("Database insert failed")
    
    return response.data[0]

@with_error_handling
def update_recommendation_status(job_id, status, result=None):
    """
    Update job status and result.
    
    Args:
        job_id (str): Job identifier
        status (str): New status ('processing', 'done', 'failed')
        result (dict, optional): Job result data
        
    Returns:
        dict: Updated record
    """
    supabase = get_supabase_client()
    print('checking len of records')
    record_check = supabase.table('recommendations').select('*').eq('job_id', job_id).execute()
    print(f"Found {len(record_check.data)} records with job_id {job_id}")
    
    update_data = {'status': status}
    if result is not None:
        if isinstance(result, (dict, list)):
            import json
            update_data['result'] = json.dumps(result)
            print(result)
        else:
            update_data['result'] = str(result)
    
    # Add updated_at timestamp
    update_data['updated_at'] = 'now()'

    print(update_data)
    
    response = supabase.table('recommendations').update(
        update_data
    ).eq('job_id', job_id).execute()
    
    if not response.data:
        logger.error(f"Failed to update job {job_id}")
        raise Exception(f"Failed to update job {job_id}")
    
    return response.data[0]

@with_error_handling
def get_recommendation_status(job_id):
    """
    Get job status and result.
    
    Args:
        job_id (str): Job identifier
        
    Returns:
        dict: Job record or None if not found
    """
    supabase = get_supabase_client()
    
    response = supabase.table('recommendations').select('*').eq('job_id', job_id).single().execute()
    
    return response.data

@with_error_handling
def get_user_recommendations(user_id, limit=10):
    """
    Get a user's recommendation history.
    
    Args:
        user_id (str): User identifier
        limit (int): Maximum number of records to return
        
    Returns:
        list: List of recommendation records
    """
    supabase = get_supabase_client()
    
    response = supabase.table('recommendations').select(
        'job_id,user_query,status,created_at,result'
    ).eq('user_id', user_id).order('created_at', desc=True).limit(limit).execute()
    
    return response.data if response.data else []

@with_error_handling
def create_user_profile(user_id, profile_data):
    """
    Create or update a user profile in the user_profiles table.
    
    Args:
        user_id (str): User identifier
        profile_data (dict): Profile data to store
        
    Returns:
        dict: Created/updated profile record
    """
    supabase = get_supabase_client()
    
    # Check if profile exists
    profile_exists = supabase.table('user_profiles').select('*').eq('user_id', user_id).execute()
    
    if profile_exists.data and len(profile_exists.data) > 0:
        # Update existing profile
        # Convert JSON fields to strings
        import json
        for field in ['allergies', 'medication_history']:
            if field in profile_data and profile_data[field] is not None:
                profile_data[field] = json.dumps(profile_data[field])
        
        # Add updated_at timestamp
        profile_data['updated_at'] = 'now()'
        
        response = supabase.table('user_profiles').update(profile_data).eq('user_id', user_id).execute()
    else:
        # Create new profile
        import json
        for field in ['allergies', 'medication_history']:
            if field in profile_data and profile_data[field] is not None:
                profile_data[field] = json.dumps(profile_data[field])
        
        # Add timestamps
        profile_data['user_id'] = user_id
        profile_data['created_at'] = 'now()'
        profile_data['updated_at'] = 'now()'
        
        response = supabase.table('user_profiles').insert(profile_data).execute()
    
    return response.data[0] if response.data else None