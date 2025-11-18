# app/utils/timezone.py
"""
Timezone utilities for handling user timezones.
"""

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

# Removed old Redis-based cache service (no longer needed)