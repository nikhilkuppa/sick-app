# app/api/validators.py
"""
Input validation utilities for API endpoints.
"""
from flask import request, jsonify
from functools import wraps
import re
import pytz

def validate_symptoms(func):
    """
    Decorator to validate symptoms input.
    
    Args:
        func: Function to decorate
        
    Returns:
        function: Decorated function
    """
    @wraps(func)
    def decorated_function(*args, **kwargs):
        data = request.get_json() or {}
        symptoms = data.get('symptoms', '').strip()
        
        # Check if symptoms are provided
        if not symptoms:
            return jsonify({'error': 'Missing symptoms parameter'}), 400
        
        # Check length
        if len(symptoms) > 500:
            return jsonify({'error': 'Symptoms text exceeds maximum length of 500 characters'}), 400
        
        # Sanitize input (optional)
        data['symptoms'] = sanitize_input(symptoms)
        
        return func(*args, **kwargs)
    
    return decorated_function

def validate_medication_tracking(func):
    """
    Decorator to validate medication tracking input.
    
    Args:
        func: Function to decorate
        
    Returns:
        function: Decorated function
    """
    @wraps(func)
    def decorated_function(*args, **kwargs):
        data = request.get_json() or {}
        
        # Validate timezone if provided
        if 'timezone' in data:
            if not validate_timezone(data['timezone']):
                return jsonify({'error': 'Invalid timezone'}), 400
        
        # Add caregiver validation
        if 'caregiver_id' in data:
            if not validate_caregiver_access(data['user_id'], data['caregiver_id']):
                return jsonify({'error': 'Invalid caregiver access'}), 403
        
        # Required fields
        required_fields = ['drug_name', 'frequency', 'start_date']
        for field in required_fields:
            if not data.get(field):
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        # Validate date format (YYYY-MM-DD)
        date_fields = ['start_date', 'end_date']
        date_pattern = re.compile(r'^\d{4}-\d{2}-\d{2}$')
        
        for field in date_fields:
            if field in data and data[field] and not date_pattern.match(data[field]):
                return jsonify({'error': f'Invalid date format for {field}. Use YYYY-MM-DD.'}), 400
        
        # Validate reminder times if enabled
        if data.get('reminder_enabled') and not data.get('reminder_times'):
            return jsonify({'error': 'Reminder times are required when reminders are enabled'}), 400
            
        # Validate time format (HH:MM) for reminder times
        if data.get('reminder_times'):
            time_pattern = re.compile(r'^([01]?[0-9]|2[0-3]):[0-5][0-9]$')
            for time in data['reminder_times']:
                if not time_pattern.match(time):
                    return jsonify({'error': f'Invalid time format for reminder time: {time}. Use HH:MM format.'}), 400
        
        return func(*args, **kwargs)
    
    return decorated_function

def sanitize_input(text):
    """
    Sanitize user input to prevent XSS and other injection attacks.
    
    Args:
        text (str): Input text
        
    Returns:
        str: Sanitized text
    """
    # Replace potentially harmful characters
    sanitized = text.replace('<', '&lt;').replace('>', '&gt;')
    
    # Remove any script-like content
    sanitized = re.sub(r'javascript:', '', sanitized, flags=re.IGNORECASE)
    
    return sanitized

def validate_medication_status(user_id, medication_id, status, date, time):
    """Validate medication status update"""
    if status not in ['taken', 'skipped', 'partial', 'missed', 'not_applicable', 'late', 'early']:
        return False, 'Invalid status'
        
    # Validate time window
    if not validate_time_window(user_id, medication_id, date, time):
        return False, 'Invalid time window for medication'
        
    return True, None

def validate_timezone(timezone):
    """Validate timezone string."""
    try:
        pytz.timezone(timezone)
        return True
    except pytz.exceptions.UnknownTimeZoneError:
        return False

def validate_caregiver_access(user_id, caregiver_id):
    # Implementation of validate_caregiver_access function
    pass

def validate_time_window(user_id, medication_id, date, time):
    # Implementation of validate_time_window function
    pass