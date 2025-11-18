# app/auth/middleware.py
from functools import wraps
from flask import request, jsonify, current_app, g
from app.auth.services import get_user
from app.auth.rate_limiter import (
    get_request_count, 
    get_user_request_count,
    increment_user_request_count
)

def require_auth(func):
    """Decorator to require authentication for a route."""
    @wraps(func)
    def decorated_function(*args, **kwargs):
        # Get authorization header
        auth_header = request.headers.get('Authorization')
        
        # Check if header exists and has correct format
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Authentication required'}), 401
        
        # Extract token
        token = auth_header[7:]  # Remove 'Bearer ' prefix
        
        # Verify token and get user
        user_info = get_user(token)
        
        # Check if token is valid
        if 'error' in user_info:
            return jsonify({'error': user_info['error']}), 401
        
        # Add user info to request context
        request.user = user_info
        
        # Continue to the route handler
        return func(*args, **kwargs)
    
    return decorated_function

def require_role(role):
    """Decorator to require a specific role for a route."""
    def decorator(func):
        @wraps(func)
        @require_auth
        def decorated_function(*args, **kwargs):
            # Check if user has required role
            if request.user.get('role') != role:
                return jsonify({'error': 'Insufficient permissions'}), 403
            
            # Continue to the route handler
            return func(*args, **kwargs)
        
        return decorated_function
    
    return decorator

def require_subscription_tier(tier):
    """Decorator to require a specific subscription tier for a route."""
    def decorator(func):
        @wraps(func)
        @require_auth
        def decorated_function(*args, **kwargs):
            # Check if user has required subscription tier
            user_tier = request.user.get('subscription_tier', 'free')
            
            # Define tier hierarchy
            tier_levels = {
                'free': 0,
                'basic': 1,
                'premium': 2
            }
            
            # Check if user's tier is at least the required tier
            if tier_levels.get(user_tier, 0) < tier_levels.get(tier, 0):
                return jsonify({
                    'error': 'Subscription required',
                    'required_tier': tier,
                    'current_tier': user_tier
                }), 403
            
            # Continue to the route handler
            return func(*args, **kwargs)
        
        return decorated_function
    
    return decorator

def check_user_rate_limit(user_id, subscription_tier='free'):
    """
    Check rate limits for authenticated users based on their subscription tier.
    
    Args:
        user_id (str): User ID
        subscription_tier (str): Subscription tier
        
    Returns:
        dict: Rate limit information
    """
    # Get request count
    count = get_user_request_count(user_id)
    
    # Define limits by tier
    limits = {
        'free': 50,     # Free tier: 10 requests per day
        'basic': 25,    # Basic tier: 25 requests per day
        'premium': 50   # Premium tier: 50 requests per day
    }
    
    # Get limit for user's tier (default to free)
    limit = limits.get(subscription_tier, limits['free'])
    
    # For admin users, ignore limits
    if subscription_tier == 'admin':
        return {
            'count': count,
            'limit': float('inf'),
            'remaining': float('inf'),
            'can_request': True
        }
    
    # Calculate remaining requests
    remaining = max(0, limit - count)
    
    # Return limit information
    return {
        'count': count,
        'limit': limit,
        'remaining': remaining,
        'can_request': remaining > 0
    }

def optional_auth(func):
    """
    Decorator to handle optional authentication.
    If the user is authenticated, their info is added to the request context.
    If not, the request continues as anonymous.
    """
    @wraps(func)
    def decorated_function(*args, **kwargs):
        # Get authorization header
        auth_header = request.headers.get('Authorization')
        
        if auth_header and auth_header.startswith('Bearer '):
            # Try to authenticate
            token = auth_header[7:]  # Remove 'Bearer ' prefix
            user_info = get_user(token)
            
            if 'error' not in user_info:
                # Add user info to request context
                request.user = user_info
                
                # Track request for authenticated users
                if 'user_id' in user_info:
                    # Check rate limit
                    limit_info = check_user_rate_limit(
                        user_info['user_id'], 
                        user_info.get('subscription_tier', 'free')
                    )
                    
                    # If rate limit exceeded, return error
                    if not limit_info['can_request'] and request.path.endswith('/recommendation'):
                        return jsonify({
                            'error': 'Rate limit exceeded',
                            'limit': limit_info['limit'],
                            'count': limit_info['count'],
                            'tier': user_info.get('subscription_tier', 'free')
                        }), 429
                    
                    # Increment count if this is a recommendation request
                    if request.path.endswith('/recommendation') and request.method == 'POST':
                        increment_user_request_count(user_info['user_id'])
                
                return func(*args, **kwargs)
        
        # If no auth or invalid auth, proceed as anonymous
        request.user = {'is_anonymous': True}
        return func(*args, **kwargs)
    
    return decorated_function