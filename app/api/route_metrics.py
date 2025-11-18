# app/api/route_metrics.py
"""
Flask-specific metrics for API routes.
This module contains decorators and utilities that depend on Flask's request context.
"""
import time
import functools
from flask import request, current_app
from app.utils.metrics import track_response_time

def route_timed_execution(func):
    """
    Decorator to measure execution time of a Flask route.
    This version is ONLY for Flask routes, not background tasks.
    """
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start_time = time.time()
        try:
            result = func(*args, **kwargs)
            return result
        finally:
            execution_time = (time.time() - start_time) * 1000  # Convert to ms
            endpoint = request.endpoint if hasattr(request, 'endpoint') else func.__name__
            track_response_time(endpoint, execution_time)
    return wrapper