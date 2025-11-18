# app/auth/rate_limiter.py
"""
Rate limiting module - temporarily using in-memory storage.
TODO: Migrate to Supabase for persistent rate limiting across server restarts.
"""

import datetime
import logging
import time
from collections import defaultdict
import threading

# Initialize logger
logger = logging.getLogger(__name__)

# In-memory rate limit storage (thread-safe)
# Structure: {key: (count, expiry_timestamp)}
_rate_limits = defaultdict(lambda: (0, 0))
_rate_limits_lock = threading.Lock()

# Expiration time for rate limit records (in seconds)
ANON_EXPIRY = 30 * 86400  # 30 days
USER_EXPIRY = 86400       # 24 hours

def _cleanup_expired():
    """Clean up expired rate limit entries."""
    now = time.time()
    with _rate_limits_lock:
        expired_keys = [k for k, (_, exp) in _rate_limits.items() if exp < now]
        for key in expired_keys:
            del _rate_limits[key]

def get_request_count(ip_address):
    """
    Get the number of requests made by an anonymous user (by IP).

    Args:
        ip_address (str): Client IP address

    Returns:
        int: Number of requests made
    """
    try:
        _cleanup_expired()
        key = f"anon:{ip_address}"
        with _rate_limits_lock:
            count, expiry = _rate_limits.get(key, (0, 0))
            if time.time() > expiry:
                return 0
            return count
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
        key = f"anon:{ip_address}"
        with _rate_limits_lock:
            count, expiry = _rate_limits.get(key, (0, 0))
            if time.time() > expiry:
                count = 0
            count += 1
            _rate_limits[key] = (count, time.time() + ANON_EXPIRY)
            logger.info(f"Incremented anonymous request count for {ip_address}: {count}")
            return count
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
        _cleanup_expired()
        today = datetime.date.today().isoformat()
        key = f"user:{user_id}:{today}"
        with _rate_limits_lock:
            count, expiry = _rate_limits.get(key, (0, 0))
            if time.time() > expiry:
                return 0
            return count
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
        today = datetime.date.today().isoformat()
        key = f"user:{user_id}:{today}"
        with _rate_limits_lock:
            count, expiry = _rate_limits.get(key, (0, 0))
            if time.time() > expiry:
                count = 0
            count += 1
            _rate_limits[key] = (count, time.time() + USER_EXPIRY)
            logger.info(f"Incremented user request count for {user_id}: {count}")
            return count
    except Exception as e:
        logger.error(f"Error incrementing user request count: {str(e)}")
        return 0