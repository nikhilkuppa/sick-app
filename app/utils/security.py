# app/utils/security.py
import re
import html
from functools import wraps
from flask import request, jsonify, current_app

def sanitize_input(text):
    """
    Sanitize user input to prevent XSS and other injection attacks.
    
    Args:
        text (str): The input text to sanitize
        
    Returns:
        str: Sanitized text
    """
    if not text:
        return ""
    
    # Convert HTML special characters to entities
    sanitized = html.escape(text)
    
    # Remove any script-like content
    sanitized = re.sub(r'javascript:', '', sanitized, flags=re.IGNORECASE)
    
    # Remove excessive whitespace
    sanitized = re.sub(r'\s+', ' ', sanitized).strip()
    
    return sanitized

def validate_input(max_length=500):
    """
    Decorator to validate and sanitize input for API endpoints.
    
    Args:
        max_length (int): Maximum allowed length for input
        
    Returns:
        function: Decorated function
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            from app.config import active_config
            
            # Get JSON data
            data = request.get_json() or {}
            
            # Validate symptoms input
            if 'symptoms' in data:
                symptoms = data.get('symptoms', '').strip()
                
                # Check length
                if not symptoms:
                    return jsonify({'error': 'Missing symptoms parameter'}), 400
                    
                if len(symptoms) > max_length:
                    return jsonify({'error': f'Symptoms text exceeds maximum length of {max_length} characters'}), 400
                
                # Sanitize if configured
                if active_config.SANITIZE_INPUT:
                    data['symptoms'] = sanitize_input(symptoms)
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def rate_limit_by_ip(limit_string):
    """
    Decorator to apply rate limiting based on IP address.
    
    Args:
        limit_string (str): Rate limit string (e.g. "100 per day")
        
    Returns:
        function: Decorated function
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Rate limiting is handled by flask-limiter
            # This is just a convenient wrapper for endpoints
            return f(*args, **kwargs)
        
        # Apply rate limit using flask-limiter
        from app import limiter
        decorated_function = limiter.limit(limit_string)(decorated_function)
        
        return decorated_function
    return decorator