# app/__init__.py
from flask import Flask
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import logging
import os
from app.config import active_config
from app.utils.logger import setup_logging

# Initialize in-memory rate limiter (NO REDIS!)
# Uses simple in-memory storage instead of Redis
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri="memory://",  # In-memory storage
    default_limits=[active_config.RATE_LIMIT_DEFAULT]
)

# Import new caching and task queue systems
from app.core.caching_new import memory_cache, cache_result
from app.core.task_queue import task_queue, enqueue_task

def create_app():
    """Create and configure the Flask application."""
    # Initialize Flask app
    app = Flask(__name__, 
                template_folder='static', 
                static_folder='static')
    
    # Setup logging
    setup_logging(app, active_config.LOG_LEVEL)
    
    # Configure CORS
    CORS(app, resources={r"/*": {"origins": active_config.ALLOWED_ORIGINS}})
    
    # Initialize rate limiter
    limiter.init_app(app)
    
    # Register API blueprint
    from app.api.routes import api_bp
    app.register_blueprint(api_bp)
    
    # Register auth blueprint
    from app.auth.routes import auth_bp
    app.register_blueprint(auth_bp)
    
    # Register the main route for the web interface
    @app.route('/')
    def index():
        return app.send_static_file('index.html')
    
    # Register error handlers
    register_error_handlers(app)
    
    app.logger.info("Application initialized successfully")
    
    return app

def register_error_handlers(app):
    """Register error handlers for the application."""
    @app.errorhandler(404)
    def not_found(error):
        return {"error": "Resource not found"}, 404
    
    @app.errorhandler(500)
    def server_error(error):
        app.logger.error(f"Server error: {error}")
        return {"error": "Internal server error"}, 500
    
    @app.errorhandler(429)
    def ratelimit_error(error):
        return {"error": "Rate limit exceeded"}, 429