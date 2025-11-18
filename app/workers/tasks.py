# app/workers/tasks.py
import json
import logging
import traceback
from app.core.recommender import generate_recommendation
from app.db.supabase_client import update_recommendation_status
from app.utils.metrics import track_worker_job
from app.core.task_queue import register_task

# Initialize logger
logger = logging.getLogger(__name__)

@register_task
def process_symptoms(symptom_query: str, job_id: str, user_profile=None, subscription_tier='anonymous'):
    """
    Process symptoms and generate recommendations.
    
    This is the main background task that:
    1. Updates job status to 'processing'
    2. Generates recommendations
    3. Updates job status to 'done' with the result
    
    Args:
        symptom_query (str): User symptoms query
        job_id (str): Unique job ID
        user_profile (dict, optional): User profile data
        subscription_tier (str, optional): User's subscription tier
        
    Returns:
        dict: Recommendation result
    """
    logger.info(f"Starting job {job_id} for query: {symptom_query}")
    track_worker_job("process_symptoms", "start")
    
    try:
        # Update job status to processing
        
        update_recommendation_status(job_id, 'processing')
        
        # Prepare additional context for recommendation
        context = {}
        
        if user_profile:
            # If user_profile is a JSON string, parse it
            if isinstance(user_profile, str):
                try:
                    user_profile = json.loads(user_profile)
                except json.JSONDecodeError:
                    logger.warning(f"Failed to parse user profile JSON for job {job_id}")
                    user_profile = {}
            
            # Add relevant profile info to context
            if isinstance(user_profile, dict):
                age = user_profile.get('age')
                gender = user_profile.get('gender')
                allergies = user_profile.get('allergies', [])
                medication_history = user_profile.get('medication_history', [])
                
                if age is not None:
                    context['age'] = age
                if gender:
                    context['gender'] = gender
                if allergies:
                    context['allergies'] = allergies
                if medication_history:
                    context['medication_history'] = medication_history
        
        # Add subscription tier to context
        context['subscription_tier'] = subscription_tier
        
        # Generate recommendation with additional context
        result = generate_recommendation(symptom_query, context)
        logger.info(f"Job {job_id} generated recommendation successfully")
        
        # Check for errors in result
        if isinstance(result, dict) and 'error' in result:
            logger.error(f"Error in recommendation for job {job_id}: {result['error']}")
            update_recommendation_status(job_id, 'failed', result)
            track_worker_job("process_symptoms", "error")
            return result
        
        # Update job status to done
        logger.info(f"Updating job {job_id} status to 'done'")
        update_recommendation_status(job_id, 'done', result)
        track_worker_job("process_symptoms", "success")
        
        return result
        
    except Exception as e:
        # Log the full exception with traceback
        logger.exception(f"Error processing symptoms for job {job_id}")
        
        # Construct error message
        error_msg = {
            "error": str(e),
            "traceback": traceback.format_exc()
        }
        
        # Update job status to failed
        try:
            update_recommendation_status(job_id, 'failed', error_msg)
        except Exception as update_error:
            logger.critical(f"Failed to record error status: {update_error}")
        
        track_worker_job("process_symptoms", "exception")
        
        # Re-raise the exception for the worker to handle
        raise