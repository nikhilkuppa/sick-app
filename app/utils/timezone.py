# app/utils/timezone.py
import pytz
from datetime import datetime
from app.db.supabase_client import get_supabase_client

def get_user_datetime(user_id):
    """Get current datetime in user's timezone"""
    supabase = get_supabase_client()
    user_profile = supabase.table('user_profiles')\
        .select('timezone')\
        .eq('user_id', user_id)\
        .single().execute()
    user_timezone = user_profile.data.get('timezone', 'UTC')
    return datetime.now(pytz.timezone(user_timezone))

# app/services/reminder.py
class ReminderService:
    def __init__(self, user_id):
        self.user_id = user_id
        self.supabase = get_supabase_client()

    def should_send_reminder(self, medication_id):
        # Reminder logic
        pass

    def send_reminder(self, medication_id):
        # Email sending logic
        pass

# app/services/cache.py
from app import redis_client

class CacheService:
    @staticmethod
    def get_cache_key(user_id, medication_id, date):
        # Cache key generation logic
        pass

    @staticmethod
    def invalidate_cache(user_id, medication_id):
        # Cache invalidation logic
        pass