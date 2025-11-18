# app/auth/rate_limiter.py
import datetime
import logging
from app import redis_client

# Initialize logger
logger = logging.getLogger(__name__)

# Key prefixes for Redis
ANON_PREFIX = "rate:anon:"
USER_PREFIX = "rate:user:"

# Expiration time for rate limit records (in seconds)
ANON_EXPIRY = 30 * 86400  # 30 days (anonymous users get a limited number of total requests)
USER_EXPIRY = 86400       # 24 hours (authenticated users get daily quotas)

def get_request_count(ip_address):
    """
    Get the number of requests made by an anonymous user (by IP).
    
    Args:
        ip_address (str): Client IP address
        
    Returns:
        int: Number of requests made
    """
    try:
        key = f"{ANON_PREFIX}{ip_address}"
        count = redis_client.get(key)
        return int(count) if count else 0
    except Exception as e:
        logger.error(f"Error getting anonymous request count: {str(e)}")
        return 0

def increment_request_count(ip_address):
    """
    Increment the request count for an anonymous user (by IP).
    Only called after a successful recommendation.
    
    Args:
        ip_address (str): Client IP address
        
    Returns:
        int: New request count
    """
    try:
        key = f"{ANON_PREFIX}{ip_address}"
        pipe = redis_client.pipeline()
        pipe.incr(key)
        pipe.expire(key, ANON_EXPIRY)
        results = pipe.execute()
        logger.info(f"Incremented anonymous request count for {ip_address}: {results[0]}")
        return results[0]  # New count
    except Exception as e:
        logger.error(f"Error incrementing anonymous request count: {str(e)}")
        return 0

def get_user_request_count(user_id):
    """
    Get the number of requests made by an authenticated user.
    
    Args:
        user_id (str): User's unique identifier
        
    Returns:
        int: Number of requests made today
    """
    try:
        # Use a daily key to reset counts every day
        today = datetime.date.today().isoformat()
        key = f"{USER_PREFIX}{user_id}:{today}"
        count = redis_client.get(key)
        return int(count) if count else 0
    except Exception as e:
        logger.error(f"Error getting user request count: {str(e)}")
        return 0

def increment_user_request_count(user_id):
    """
    Increment the request count for an authenticated user.
    
    Args:
        user_id (str): User's unique identifier
        
    Returns:
        int: New request count
    """
    try:
        # Use a daily key to reset counts every day
        today = datetime.date.today().isoformat()
        key = f"{USER_PREFIX}{user_id}:{today}"
        pipe = redis_client.pipeline()
        pipe.incr(key)
        pipe.expire(key, USER_EXPIRY)
        results = pipe.execute()
        logger.info(f"Incremented user request count for {user_id}: {results[0]}")
        return results[0]  # New count
    except Exception as e:
        logger.error(f"Error incrementing user request count: {str(e)}")
        return 0