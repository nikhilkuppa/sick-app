# app/utils/logger.py
import logging
import os
from logging.handlers import RotatingFileHandler
import time
import uuid
from flask import has_request_context

class RequestIdFilter(logging.Filter):
    """Add request ID to log records for tracking request flow."""
    
    def filter(self, record):
        if not hasattr(record, 'request_id'):
            record.request_id = str(uuid.uuid4())
        return True

def setup_logging(app, log_level="INFO"):
    """Configure application logging."""
    # Set log level
    log_level_obj = getattr(logging, log_level.upper())
    app.logger.setLevel(log_level_obj)
    
    # Create formatter
    formatter = logging.Formatter(
        '[%(asctime)s] [%(request_id)s] [%(levelname)s] [%(module)s:%(lineno)d] - %(message)s'
    )
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.addFilter(RequestIdFilter())
    
    # File handler (in production)
    if os.environ.get("FLASK_ENV") == "production":
        logs_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "logs")
        os.makedirs(logs_dir, exist_ok=True)
        
        # Main log file
        file_handler = RotatingFileHandler(
            os.path.join(logs_dir, "app.log"),
            maxBytes=10485760,  # 10MB
            backupCount=10
        )
        file_handler.setFormatter(formatter)
        file_handler.addFilter(RequestIdFilter())
        
        # Error log file
        error_handler = RotatingFileHandler(
            os.path.join(logs_dir, "error.log"),
            maxBytes=10485760,  # 10MB
            backupCount=10
        )
        error_handler.setLevel(logging.ERROR)
        error_handler.setFormatter(formatter)
        error_handler.addFilter(RequestIdFilter())
        
        # Add handlers
        app.logger.addHandler(file_handler)
        app.logger.addHandler(error_handler)
    
    # Always add console handler
    app.logger.addHandler(console_handler)
    
    # Remove default Flask handler
    app.logger.handlers = [h for h in app.logger.handlers if not isinstance(h, logging.StreamHandler)] + [console_handler]
    
    # Log startup
    app.logger.info(f"Logging initialized at {log_level} level")
    
    # Add request logging - only for Flask contexts
    @app.before_request
    def before_request():
        # Only run this in a request context
        if has_request_context():
            request_id = str(uuid.uuid4())
            app.logger.new_request_id = request_id
            app.logger.info(f"Request started: {request_id}")
            
            # Add request start time
            app.logger.start_time = time.time()
    
    @app.after_request
    def after_request(response):
        # Only run this in a request context
        if has_request_context():
            # Calculate request duration
            duration = time.time() - getattr(app.logger, 'start_time', time.time())
            app.logger.info(f"Request completed in {duration:.4f}s with status {response.status_code}")
        return response