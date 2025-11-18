# app/auth/services.py
import json
import logging
import urllib.parse
from flask import current_app, url_for
from app.db.supabase_client import get_supabase_client
from app.config import active_config
import traceback

# Initialize logger
logger = logging.getLogger(__name__)

def get_social_auth_url(provider, redirect_to='/'):
    """
    Get the URL for social authentication using Supabase.
    
    Args:
        provider (str): Social provider (google, apple, facebook, github)
        redirect_to (str): URL to redirect to after authentication
        
    Returns:
        str: URL for social authentication
    """
    supabase = get_supabase_client()
    
    # List of supported providers
    supported_providers = ['google', 'apple', 'facebook', 'github']
    
    if provider not in supported_providers:
        logger.error(f"Unsupported provider: {provider}")
        return None
    
    try:
        # Construct callback URL
        callback_url = redirect_to
        logger.info(f"Auth callback URL: {callback_url}")

        # Construct Supabase auth URL manually
        supabase_url = active_config.SUPABASE_URL
        if not supabase_url:
            logger.error("SUPABASE_URL is not set in environment")
            return None

        query_params = {
            "provider": provider,
            "redirect_to": callback_url
        }

        # Add prompt=select_account for Google only
        if provider == 'google':
            query_params["prompt"] = "select_account"

        params = urllib.parse.urlencode(query_params)

        auth_url = f"{supabase_url}/auth/v1/authorize?{params}"
        logger.info(f"Generated auth URL for {provider}: {auth_url}")
        return auth_url
    except Exception as e:
        logger.error(f"Error generating social auth URL: {str(e)}")
        return None

def handle_social_callback(provider, code, redirect_to='/'):
    """
    Handle callback from social authentication provider.
    
    Args:
        provider (str): Social provider
        code (str): Authorization code
        redirect_to (str): URL to redirect to after processing
        
    Returns:
        dict: User information and tokens
    """
    supabase = get_supabase_client()
    
    try:
        # Exchange code for session
        exchange_response = supabase.auth.exchange_code_for_session({'auth_code': code})
        
        if not exchange_response.session:
            logger.error("No session in exchange response")
            return {'error': 'Failed to exchange code for session'}
        
        session = exchange_response.session
        user = session.user
        
        if not user:
            logger.error("No user in session")
            return {'error': 'Failed to get user from session'}
        
        # Get user metadata
        user_metadata = user.user_metadata or {}
        
        # Check if this is a new user
        is_new_user = False
        if not user_metadata.get('profile_completed'):
            is_new_user = True
            
            # Update user metadata
            current_metadata = user_metadata or {}
            current_metadata['profile_completed'] = False
            
            # Set default role and subscription tier for new users
            if not current_metadata.get('role'):
                current_metadata['role'] = 'user'
                current_metadata['subscription_tier'] = 'free'
                
                # Special handling for founder email
                if user.email == active_config.FOUNDER_EMAIL:
                    current_metadata['role'] = 'admin'
                    current_metadata['subscription_tier'] = 'premium'
            
            # Update user metadata using admin API
            supabase.auth.admin.update_user_by_id(
                user.id,
                {"user_metadata": current_metadata}
            )
            
            # Refresh user metadata
            user_metadata = current_metadata
        
        # Return user info and tokens
        return {
            'user_id': user.id,
            'email': user.email,
            'name': user_metadata.get('name', user_metadata.get('full_name', '')),
            'role': user_metadata.get('role', 'user'),
            'subscription_tier': user_metadata.get('subscription_tier', 'free'),
            'email_verified': user.email_confirmed_at is not None,
            'is_new_user': is_new_user,
            'profile_completed': user_metadata.get('profile_completed', False),
            'access_token': session.access_token,
            'refresh_token': session.refresh_token,
            'expires_in': session.expires_in
        }
    except Exception as e:
        logger.error(f"Error handling social auth callback: {str(e)}")
        return {'error': f"Social authentication failed: {str(e)}"}

def register_user(email, password, name="", profile_data=None):
    """
    Register a new user using Supabase Auth.
    
    Args:
        email (str): User's email address
        password (str): User's password
        name (str): User's display name
        profile_data (dict): Optional user profile information
        
    Returns:
        dict: User information and authentication tokens
    """
    supabase = get_supabase_client()
    
    try:
        # Use Supabase Auth API to sign up
        auth_response = supabase.auth.sign_up({
            "email": email,
            "password": password,
            "options": {
                "data": {
                    "name": name,
                    "role": "user",
                    "subscription_tier": "free",
                    "profile_completed": False
                }
            }
        })
        
        # Check if user was created successfully
        if not auth_response.user:
            return {'error': 'Failed to create user account'}
        
        user = auth_response.user
        session = auth_response.session
        
        if not session:
            # If auto-confirm is disabled, there might not be a session yet
            return {
                'user_id': user.id,
                'email': user.email,
                'name': name,
                'message': 'Registration successful. Please check your email to confirm your account.'
            }
        
        # Special handling for founder email
        if email == active_config.FOUNDER_EMAIL:
            # Update user metadata to admin/premium
            current_metadata = user.user_metadata or {}
            current_metadata['role'] = 'admin'
            current_metadata['subscription_tier'] = 'premium'
            
            supabase.auth.admin.update_user_by_id(
                user.id,
                {"user_metadata": current_metadata}
            )
            
            return {
                'user_id': user.id,
                'email': user.email,
                'name': name,
                'role': 'admin',
                'subscription_tier': 'premium',
                'email_verified': user.email_confirmed_at is not None,
                'profile_completed': profile_data is not None,
                'access_token': session.access_token,
                'refresh_token': session.refresh_token,
                'expires_in': session.expires_in
            }
        
        # If profile data is provided, update user metadata
        if profile_data:
            current_metadata = user.user_metadata or {}
            current_metadata['profile_completed'] = True
            
            supabase.auth.admin.update_user_by_id(
                user.id,
                {"user_metadata": current_metadata}
            )
            
            # Also create user profile record
            create_user_profile(user.id, profile_data)
        
        # Return user info and tokens
        return {
            'user_id': user.id,
            'email': user.email,
            'name': name,
            'role': 'user',
            'subscription_tier': 'free',
            'email_verified': user.email_confirmed_at is not None,
            'profile_completed': profile_data is not None,
            'access_token': session.access_token,
            'refresh_token': session.refresh_token,
            'expires_in': session.expires_in
        }
    except Exception as e:
        logger.error(f"Error registering user: {str(e)}")
        return {'error': f"Registration failed: {str(e)}"}

def login_user(email, password):
    """
    Log in an existing user.
    
    Args:
        email (str): User's email address
        password (str): User's password
        
    Returns:
        dict: User information and authentication tokens
    """
    supabase = get_supabase_client()
    
    try:
        # Sign in with Supabase Auth
        sign_in_response = supabase.auth.sign_in_with_password({
            "email": email,
            "password": password
        })
        
        if not sign_in_response.user or not sign_in_response.session:
            return {'error': 'Invalid email or password'}
        
        user = sign_in_response.user
        session = sign_in_response.session
        
        # Get user metadata
        user_data = user.user_metadata or {}
        
        # Return user info and tokens
        return {
            'user_id': user.id,
            'email': user.email,
            'name': user_data.get('name', ''),
            'role': user_data.get('role', 'user'),
            'subscription_tier': user_data.get('subscription_tier', 'free'),
            'email_verified': user.email_confirmed_at is not None,
            'profile_completed': user_data.get('profile_completed', False),
            'access_token': session.access_token,
            'refresh_token': session.refresh_token,
            'expires_in': session.expires_in
        }
    except Exception as e:
        logger.error(f"Error logging in user: {str(e)}")
        return {'error': f"Login failed: {str(e)}"}

def verify_email(token):
    """
    Verify a user's email address using a token.
    
    Args:
        token (str): Email verification token
        
    Returns:
        dict: Result of the verification
    """
    supabase = get_supabase_client()
    
    try:
        # Verify email with Supabase Auth
        verify_response = supabase.auth.verify_otp({
            "token_hash": token,
            "type": "email"
        })
        
        if not verify_response.user:
            return {'error': 'Invalid verification link'}
        
        return {'message': 'Email verified successfully'}
    except Exception as e:
        logger.error(f"Error verifying email: {str(e)}")
        return {'error': f"Verification failed: {str(e)}"}

def get_user(token):
    """
    Get user information from token.
    
    Args:
        token (str): JWT access token
        
    Returns:
        dict: User information
    """
    supabase = get_supabase_client()
    
    try:
        # Set auth token
        # The newer version of Supabase client requires both access_token and refresh_token
        try:
            # Try with just access_token first (older versions)
            supabase.auth.set_session(token)
        except TypeError:
            # If that doesn't work, try the JWT method instead
            # This is a workaround for the refresh_token requirement
            user_response = supabase.auth.get_user(token)
            # If we get here, we've successfully gotten the user
        else:
            # If the first method worked, get the user
            user_response = supabase.auth.get_user()
        
        if not user_response.user:
            return {'error': 'Invalid token'}
        
        user = user_response.user
        user_data = user.user_metadata or {}
        
        # Return user info
        return {
            'user_id': user.id,
            'email': user.email,
            'name': user_data.get('name', user_data.get('full_name', '')),
            'role': user_data.get('role', 'user'),
            'subscription_tier': user_data.get('subscription_tier', 'free'),
            'profile_completed': user_data.get('profile_completed', False)
        }
    except Exception as e:
        logger.error(f"Error getting user from token: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return {'error': 'Invalid token'}

def refresh_token(refresh_token_str):
    """
    Refresh the access token using a refresh token.
    
    Args:
        refresh_token_str (str): JWT refresh token
        
    Returns:
        dict: New access and refresh tokens
    """
    supabase = get_supabase_client()
    
    try:
        # Refresh session
        refresh_response = supabase.auth.refresh_session({
            "refresh_token": refresh_token_str
        })
        
        if not refresh_response.user or not refresh_response.session:
            return {'error': 'Invalid refresh token'}
        
        user = refresh_response.user
        session = refresh_response.session
        user_data = user.user_metadata or {}
        
        # Return new tokens
        return {
            'user_id': user.id,
            'email': user.email,
            'name': user_data.get('name', user_data.get('full_name', '')),
            'role': user_data.get('role', 'user'),
            'subscription_tier': user_data.get('subscription_tier', 'free'),
            'profile_completed': user_data.get('profile_completed', False),
            'access_token': session.access_token,
            'refresh_token': session.refresh_token,
            'expires_in': session.expires_in
        }
    except Exception as e:
        logger.error(f"Error refreshing token: {str(e)}")
        return {'error': f"Token refresh failed: {str(e)}"}

def reset_password_request(email):
    """
    Request a password reset.
    
    Args:
        email (str): User's email address
        
    Returns:
        dict: Result of the request
    """
    supabase = get_supabase_client()
    
    try:
        # Request password reset with Supabase Auth
        supabase.auth.reset_password_email(email)
        
        # Always return success to prevent email enumeration
        return {'message': 'If your email is registered, you will receive a password reset link'}
    except Exception as e:
        logger.error(f"Error requesting password reset: {str(e)}")
        # Still return success message to prevent email enumeration
        return {'message': 'If your email is registered, you will receive a password reset link'}

def reset_password_confirm(token, new_password):
    """
    Reset a user's password using a token.
    
    Args:
        token (str): Password reset token
        new_password (str): New password
        
    Returns:
        dict: Result of the password reset
    """
    supabase = get_supabase_client()
    
    try:
        # Confirm password reset with Supabase Auth
        update_response = supabase.auth.verify_otp({
            "token_hash": token, 
            "type": "recovery",
            "new_password": new_password
        })
        
        if not update_response.user:
            return {'error': 'Invalid reset token'}
        
        return {'message': 'Password reset successful'}
    except Exception as e:
        logger.error(f"Error confirming password reset: {str(e)}")
        return {'error': f"Password reset failed: {str(e)}"}

def create_user_profile(user_id, profile_data):
    """
    Create a user profile record in the database.
    
    Args:
        user_id (str): User's unique identifier
        profile_data (dict): Profile information
        
    Returns:
        dict: Created profile or error
    """
    from app.db.supabase_client import get_supabase_client
    supabase = get_supabase_client()
    
    try:
        # Convert JSON fields to strings
        import json
        for field in ['allergies', 'medication_history']:
            if field in profile_data and profile_data[field] is not None:
                profile_data[field] = json.dumps(profile_data[field])
        
        # Add user_id and timestamps
        profile_record = {
            'user_id': user_id,
            'name': profile_data.get('name'),
            'age': profile_data.get('age'),
            'gender': profile_data.get('gender'),
            'zip_code': profile_data.get('zip_code'),
            'allergies': profile_data.get('allergies'),
            'medication_history': profile_data.get('medication_history'),
            'created_at': 'now()',
            'updated_at': 'now()'
        }
        
        # Insert profile record
        print('** INSERTING PROFILE ***', profile_record)
        response = supabase.table('user_profiles').insert(profile_record).execute()
        
        if not response.data:
            print('failed lmaooooooooo')
            logger.error(f"Failed to create profile for user {user_id}")
            return {'error': 'Failed to create user profile'}
        print('returning response after creating user')
        return response.data[0]
    except Exception as e:
        print('error creating user')
        logger.error(f"Error creating user profile: {str(e)}")
        return {'error': f"Profile creation failed: {str(e)}"}

def update_user_profile(user_id, profile_data):
    """
    Update a user's profile information.
    
    Args:
        user_id (str): User's unique identifier
        profile_data (dict): Profile information to update
        
    Returns:
        dict: Updated profile information
    """
    supabase = get_supabase_client()
    
    try:
        # First get current user data
        print("*** getting user response ***")
        user_response = supabase.auth.admin.get_user_by_id(user_id)
        if not user_response.user:
            print("❌ User not found in Supabase Auth")
            return {'error': 'User not found'}
        print('*** user response: ', user_response)
        if not user_response.user:
            return {'error': 'User not found'}
        
        print('*** getting current_metadata ***')
        current_metadata = user_response.user.user_metadata or {}
        print('*** current_metadata: ', user_response)

        # Update profile completed flag
        current_metadata['profile_completed'] = True
        
        # Update name if provided
        print('*** trying get name ***')
        if profile_data.get('name'):
            print('*** name exists ***')
            current_metadata['name'] = profile_data['name']
        
        # Update user metadata
        print('*** updating user metadata ***')
        update_response = supabase.auth.admin.update_user_by_id(
            user_id,
            {"user_metadata": current_metadata}
        )
        print('*** updated user metadata ***')
        
        # Check if user_profiles table exists and create/update profile record
        try:
            # Check if profile exists
            print('*** checking profile exists ***')
            profile_exists = supabase.table('user_profiles').select('*').eq('user_id', user_id).execute()
            print("*** line 541 ***")
            if profile_exists.data and len(profile_exists.data) > 0:
                # Update existing profile
                print('*** updating existing acc ***')
                profile_record = {
                    'age': profile_data.get('age'),
                    'gender': profile_data.get('gender'),
                    'zip_code': profile_data.get('zip_code'),
                    'updated_at': 'now()'
                }
                
                # Handle JSON fields
                import json
                for field in ['allergies', 'medication_history']:
                    if field in profile_data and profile_data[field] is not None:
                        profile_record[field] = json.dumps(profile_data[field])
                
                print('*** UPDATING SUPABAASE TABLE USER PROFILES', profile_record)
                supabase.table('user_profiles').update(profile_record).eq('user_id', user_id).execute()
            else:
                # Create new profile
                print("supabase table update failed, creating new user")
                create_user_profile(user_id, profile_data)
        except Exception as e:
            logger.warning(f"Error updating user profile record: {str(e)}")
            # Continue even if this fails, as we've already updated the user metadata
        
        return {
            'success': True,
            'profile': {
                'name': current_metadata.get('name', ''),
                'profile_completed': current_metadata.get('profile_completed', True)
            }
        }
    except Exception as e:
        logger.error(f"Error updating user profile: {str(e)}")
        return {'error': f"Profile update failed: {str(e)}"}

def get_user_profile(user_id):
    """
    Get a user's profile information.
    
    Args:
        user_id (str): User's unique identifier
        
    Returns:
        dict: User's profile information
    """
    supabase = get_supabase_client()
    
    try:
        # Get user from auth
        user_response = supabase.auth.admin.get_user_by_id(user_id)
        
        if not user_response.user:
            return {'error': 'User not found'}
        
        user = user_response.user
        user_data = user.user_metadata or {}
        
        # Get profile from user_profiles table if it exists
        profile_data = {}
        try:
            profile_response = supabase.table('user_profiles').select('*').eq('user_id', user_id).single().execute()
            
            if profile_response.data:
                profile_data = profile_response.data
                
                # Parse JSON fields
                import json
                for field in ['allergies', 'medication_history']:
                    if field in profile_data and isinstance(profile_data[field], str):
                        try:
                            profile_data[field] = json.loads(profile_data[field])
                        except:
                            profile_data[field] = []
        except Exception as e:
            logger.warning(f"Error getting profile record: {str(e)}")
        
        # Combine basic info with profile data
        return {
            'name': user_data.get('name', user_data.get('full_name', '')),
            'email': user.email,
            'profile_completed': user_data.get('profile_completed', False),
            'age': profile_data.get('age'),
            'gender': profile_data.get('gender'),
            'zip_code': profile_data.get('zip_code'),
            'allergies': profile_data.get('allergies', []),
            'medication_history': profile_data.get('medication_history', [])
        }
    except Exception as e:
        logger.error(f"Error getting user profile: {str(e)}")
        return {'error': f"Failed to get profile: {str(e)}"}

def update_subscription_tier(user_id, new_tier):
    """
    Update a user's subscription tier.
    
    Args:
        user_id (str): User's unique identifier
        new_tier (str): New subscription tier (e.g., 'free', 'premium')
        
    Returns:
        dict: Result of the update
    """
    supabase = get_supabase_client()
    
    try:
        # Get current user data
        user_response = supabase.auth.admin.get_user_by_id(user_id)
        if not user_response.user:
            return {'error': 'User not found'}
        
        current_metadata = user_response.user.user_metadata or {}
        current_metadata['subscription_tier'] = new_tier
        
        # Update user metadata
        update_response = supabase.auth.admin.update_user_by_id(
            user_id,
            {"user_metadata": current_metadata}
        )
        
        if not update_response.user:
            return {'error': 'Failed to update subscription tier'}
        
        return {
            'success': True,
            'subscription_tier': new_tier
        }
    except Exception as e:
        logger.error(f"Error updating subscription tier: {str(e)}")
        return {'error': f"Subscription update failed: {str(e)}"}

def check_anonymous_limit(ip_address):
    """
    Check the request limit for anonymous users.
    
    Args:
        ip_address (str): Client IP address
        
    Returns:
        dict: Limit information
    """
    from app.auth.rate_limiter import get_request_count
    
    try:
        # Get current count
        count = get_request_count(ip_address)
        
        # Anonymous users get 3 requests
        limit = active_config.ANON_REQUEST_LIMIT
        remaining = max(0, limit - count)
        
        return {
            'count': count,
            'limit': limit,
            'remaining': remaining,
            'can_request': remaining > 0
        }
    except Exception as e:
        logger.error(f"Error checking anonymous limit: {str(e)}")
        return {
            'count': 0,
            'limit': active_config.ANON_REQUEST_LIMIT,
            'remaining': active_config.ANON_REQUEST_LIMIT,
            'can_request': True
        }

def delete_user_account(user_id):
    """
    Delete a user's account and all associated data.
    
    Args:
        user_id (str): User's unique identifier
        
    Returns:
        dict: Result of the deletion
    """
    supabase = get_supabase_client()
    
    try:
        # First delete all user data from tables
        # This should trigger cascading deletes if properly configured
        
        # 1. Delete from user_profiles
        try:
            supabase.table('user_profiles').delete().eq('user_id', user_id).execute()
        except Exception as e:
            logger.warning(f"Error deleting user profile: {str(e)}")
        
        # 2. Delete from user_medications
        try:
            supabase.table('user_medications').delete().eq('user_id', user_id).execute()
        except Exception as e:
            logger.warning(f"Error deleting user medications: {str(e)}")
        
        # 3. Delete from recommendations
        try:
            supabase.table('recommendations').delete().eq('user_id', user_id).execute()
        except Exception as e:
            logger.warning(f"Error deleting user recommendations: {str(e)}")
        
        # 4. Finally delete the user account using Supabase Auth Admin API
        supabase.auth.admin.delete_user(user_id)
        
        return {
            'success': True,
            'message': 'Account deleted successfully'
        }
    except Exception as e:
        logger.error(f"Error deleting user account: {str(e)}")
        return {'error': f"Account deletion failed: {str(e)}"}