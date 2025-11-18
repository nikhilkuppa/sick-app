# run.py
from app import create_app
import os
from app.utils.metrics import initialize_metrics
from app.config import active_config

# Initialize metrics (no Redis needed!)
initialize_metrics()

# Create Flask application
app = create_app()
app.app_context().push()

if __name__ == '__main__':
    # Get port from environment or use default
    port = int(os.environ.get('PORT', 3000))
    with app.app_context():
        # Start the application
        app.run(
            host= 'localhost',  
            port=port,
            debug=(os.environ.get('FLASK_ENV') == 'development')
        )
# Command for API response:
# curl -X POST http://127.0.0.1:5000/get_recommendation -H "Content-Type: application/json" -d '{"symptoms": "headache, fever"}'
