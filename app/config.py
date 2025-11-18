# app/config.py
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class Config:
    """Base configuration class."""
    # API Configuration
    API_VERSION = "v1"
    ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
    
    # Redis Configuration
    REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
    REDIS_QUEUE_NAME = "recommendations"
    REDIS_CACHE_EXPIRATION = 3600  # 1 hour in seconds
    
    # Supabase Configuration
    SUPABASE_URL = os.environ.get("SUPABASE_URL")
    SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    
    # Gemini AI Configuration
    GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
    
    # Worker Configuration
    WORKER_CONCURRENCY = int(os.environ.get("WORKER_CONCURRENCY", 4))
    MAX_RETRIES = 3
    RETRY_INTERVALS = [10, 30, 60]  # Seconds between retries
    
    # Rate Limiting
    RATE_LIMIT_DEFAULT = "100 per day, 10 per minute"
    
    # Security
    SANITIZE_INPUT = True
    MAX_QUERY_LENGTH = 500
    
    # Paths
    DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
    DRUG_DATA_PATH = os.path.join(DATA_DIR, "medlineplus_data_v1.tsv")
    EMBEDDINGS_PATH = os.path.join(DATA_DIR, "drug_embeddings_symptoms.npy")
    
    # Stripe Configuration (for future use)
    STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY")
    STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET")
    STRIPE_FREE_PRODUCT_ID = os.environ.get("STRIPE_FREE_PRODUCT_ID")
    STRIPE_BASIC_PRODUCT_ID = os.environ.get("STRIPE_BASIC_PRODUCT_ID")
    STRIPE_PREMIUM_PRODUCT_ID = os.environ.get("STRIPE_PREMIUM_PRODUCT_ID")
    
    # Admin/Founder Access
    FOUNDER_EMAIL = os.environ.get("FOUNDER_EMAIL", "founder@example.com")
    
    # Google Maps API for pharmacy search
    GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY")

class DevelopmentConfig(Config):
    """Development configuration."""
    DEBUG = True
    TESTING = False
    LOG_LEVEL = "DEBUG"
    
    # Anonymous Rate Limiting
    ANON_REQUEST_LIMIT = 3
    
    # Tier Rate Limiting
    FREE_TIER_DAILY_LIMIT = 10
    BASIC_TIER_DAILY_LIMIT = 25
    PREMIUM_TIER_DAILY_LIMIT = 50

class ProductionConfig(Config):
    """Production configuration."""
    DEBUG = False
    TESTING = False
    LOG_LEVEL = "INFO"
    
    # In production, restrict CORS
    ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "https://yourapp.com").split(",")
    
    # Anonymous Rate Limiting
    ANON_REQUEST_LIMIT = 3
    
    # Tier Rate Limiting
    FREE_TIER_DAILY_LIMIT = 10
    BASIC_TIER_DAILY_LIMIT = 25
    PREMIUM_TIER_DAILY_LIMIT = 50

class TestingConfig(Config):
    """Testing configuration."""
    DEBUG = True
    TESTING = True
    LOG_LEVEL = "DEBUG"
    
    # Anonymous Rate Limiting - higher for testing
    ANON_REQUEST_LIMIT = 10
    
    # Tier Rate Limiting - higher for testing
    FREE_TIER_DAILY_LIMIT = 20
    BASIC_TIER_DAILY_LIMIT = 50
    PREMIUM_TIER_DAILY_LIMIT = 100

# Select configuration based on environment
config_by_name = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
    "testing": TestingConfig
}

# Default to development if not specified
active_config = config_by_name.get(os.environ.get("FLASK_ENV", "development"))