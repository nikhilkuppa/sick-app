/**
 * Authentication Module
 * Streamlined auth flow with Supabase and SSO support
 */

// Authentication API endpoints
const AUTH_API = {
    REGISTER: '/api/v1/auth/register',
    LOGIN: '/api/v1/auth/login',
    REFRESH: '/api/v1/auth/refresh',
    PROFILE: '/api/v1/auth/profile',
    USER: '/api/v1/auth/user',
    RESET_PASSWORD: '/api/v1/auth/reset-password-request',
    ANON_LIMIT: '/api/v1/auth/anonymous-limit',
    SOCIAL_LOGIN: '/api/v1/auth/social-login'
};

// Storage keys for auth data
const STORAGE_KEYS = {
    ACCESS_TOKEN: 'sick_access_token',
    REFRESH_TOKEN: 'sick_refresh_token',
    USER_INFO: 'sick_user_info',
    TOKEN_EXPIRY: 'sick_token_expiry'
};

/**
 * Authentication Service
 */
const AuthService = {
    /**
     * Initialize authentication system
     */
    init: function() {
        console.log('Initializing auth service');
        
        // Check URL for auth tokens
        const tokensFound = this.checkUrlForAuthTokens();
        
        // Only refresh token and update UI if tokens weren't found in URL
        if (!tokensFound) {
            console.log('No tokens found in URL, checking localStorage');
            // Check and refresh token if needed
            this.refreshTokenIfNeeded();
            
            // Set up login/logout UI
            this.updateAuthUI();
            
            // Check anonymous usage limit
            if (!this.isAuthenticated()) {
                this.checkAnonymousLimit();
            }
        }
    },
    
    /**
     * Check URL for Supabase auth tokens
     * This handles the redirect from Supabase after SSO authentication
     */
    checkUrlForAuthTokens: function() {
        console.log('Checking URL for auth tokens');
        console.log('Hash:', window.location.hash);
        
        // Check hash fragment for tokens (implicit flow)
        if (window.location.hash) {
            try {
                const hashParams = new URLSearchParams(window.location.hash.substring(1));
                const accessToken = hashParams.get('access_token');
                const refreshToken = hashParams.get('refresh_token');
                
                console.log('Access token from hash:', accessToken ? 'Found' : 'Not found');
                console.log('Refresh token from hash:', refreshToken ? 'Found' : 'Not found');
                
                if (accessToken && refreshToken) {
                    // Store tokens
                    localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
                    localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
                    
                    // Calculate expiry
                    const expiresIn = hashParams.get('expires_in') || 3600;
                    const expiryTime = Date.now() + (parseInt(expiresIn) * 1000);
                    localStorage.setItem(STORAGE_KEYS.TOKEN_EXPIRY, expiryTime.toString());
                    
                    console.log('Tokens stored in localStorage');
                    
                    // Store some user info from the token if possible
                    try {
                        // Try to extract user info from the token
                        const tokenParts = accessToken.split('.');
                        if (tokenParts.length === 3) {
                            const tokenPayload = JSON.parse(atob(tokenParts[1]));
                            console.log('Token payload:', tokenPayload);
                            
                            // Extract basic user info from token
                            if (tokenPayload.email && tokenPayload.user_metadata) {
                                const userInfo = {
                                    user_id: tokenPayload.sub,
                                    email: tokenPayload.email,
                                    name: tokenPayload.user_metadata.full_name || tokenPayload.user_metadata.name || '',
                                    role: tokenPayload.role === 'authenticated' ? 'user' : tokenPayload.role,
                                    subscription_tier: 'free', // Default, will be updated by getUserInfo
                                    profile_completed: false // Default, will be updated by getUserInfo
                                };
                                
                                localStorage.setItem(STORAGE_KEYS.USER_INFO, JSON.stringify(userInfo));
                                console.log('Basic user info stored from token');
                            }
                        }
                    } catch (e) {
                        console.error('Error extracting user info from token:', e);
                    }
                    
                    // Get full user info from API
                    this.getUserInfo().then(userInfo => {
                        console.log('Got user info from API:', userInfo);
                        // Update UI to reflect logged-in state
                        this.updateAuthUI();
                        
                        // Check if profile completion is needed
                        if (userInfo && !userInfo.profile_completed) {
                            // Show profile completion modal
                            this.showProfileModal();
                        }
                    }).catch(error => {
                        console.error('Error getting user info:', error);
                    });
                    
                    // Clean up URL
                    const cleanUrl = window.location.pathname;
                    window.history.replaceState({}, document.title, cleanUrl);
                    return true;
                }
            } catch (e) {
                console.error('Error processing hash params:', e);
            }
        }
        
        return false;
    },

    /**
     * Show profile completion modal for new users
     */
    showProfileModal: function() {
        const profileModal = document.getElementById('profile-completion-modal');
        if (profileModal) {
            profileModal.style.display = 'block';
            
            // Highlight that profile completion is required
            const modalTitle = profileModal.querySelector('h2');
            if (modalTitle) {
                modalTitle.textContent = 'Complete Your Profile';
                modalTitle.classList.add('required-profile');
            }
            
            // Show message about required profile
            const messageElement = document.getElementById('profile-completion-message');
            if (messageElement) {
                messageElement.textContent = 'Please complete your profile to continue using the application.';
                messageElement.style.display = 'block';
            }
        }
    },
    
    /**
     * Get current user information
     * @returns {Promise<Object>} User data
     */
    getUserInfo: async function() {
        try {
            const token = this.getAccessToken();
            // Add this in getUserInfo
            console.log('Getting user info with token:', token);
            
            if (!token) {
                return null;
            }
            
            const response = await fetch(AUTH_API.USER, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (!response.ok) {
                // If unauthorized, token might be expired
                if (response.status === 401) {
                    try {
                        // Try to refresh the token
                        await this.refreshToken();
                        // Retry with new token
                        return this.getUserInfo();
                    } catch (refreshError) {
                        this.logout();
                        return null;
                    }
                }
                throw new Error('Failed to get user info');
            }
            
            const data = await response.json();
            
            // Store user info
            localStorage.setItem(STORAGE_KEYS.USER_INFO, JSON.stringify(data));
            
            return data;
        } catch (error) {
            console.error('Error getting user info:', error);
            return null;
        }
    },
    
    /**
     * Initialize social login with a provider
     * @param {string} provider - The identity provider (google, facebook, etc.)
     */
    socialLogin: async function(provider) {
        try {
            // Get the current URL for the redirect after login
            const redirectTo = encodeURIComponent(window.location.href.split('?')[0]); // Remove any query params
            
            // Request social login URL from backend
            const response = await fetch(`${AUTH_API.SOCIAL_LOGIN}?provider=${provider}&redirect_to=${encodeURIComponent(redirectTo)}`);
            
            if (!response.ok) {
                throw new Error('Failed to initiate social login');
            }
            
            const data = await response.json();
            
            // Redirect to the social login URL
            if (data.url) {
                console.log('Redirecting to:', data.url);
                window.location.href = data.url;
            } else {
                throw new Error('No social login URL provided');
            }
        } catch (error) {
            console.error('Social login error:', error);
            this.showNotification('Failed to initiate social login', 'error');
        }
    },
    
    /**
     * Log in a user with email and password
     * @param {string} email - User's email
     * @param {string} password - User's password
     * @returns {Promise<Object>} Login result
     */
    login: async function(email, password) {
        try {
            const response = await fetch(AUTH_API.LOGIN, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Login failed');
            }
            
            // Save auth data
            this.saveAuthData(data);
            
            // Update UI
            this.updateAuthUI();
            
            // Show profile completion modal if needed
            if (!data.profile_completed) {
                this.showProfileModal();
            }
            
            // Initialize medication service after successful login
            if (window.MedicationService) {
                console.log('Initializing medication service after login');
                window.MedicationService.init();
            }
            
            return data;
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    },
    
    /**
     * Register a new user
     * @param {Object} userData - User registration data
     * @returns {Promise<Object>} Registration result
     */
    register: async function(userData) {
        try {
            const response = await fetch(AUTH_API.REGISTER, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(userData)
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Registration failed');
            }
            
            // Save auth data
            this.saveAuthData(data);
            
            // Update UI
            this.updateAuthUI();
            
            // Show profile completion modal
            this.showProfileModal();
            
            return data;
        } catch (error) {
            console.error('Registration error:', error);
            throw error;
        }
    },
    
    /**
     * Log out the current user
     */
    logout: function() {
        // Clear stored auth data
        localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.USER_INFO);
        localStorage.removeItem(STORAGE_KEYS.TOKEN_EXPIRY);
        
        // Update UI
        this.updateAuthUI();
        
        // Reload page to reset state
        window.location.reload();
    },
    
    /**
     * Refresh the access token
     * @returns {Promise<Object>} Refresh result
     */
    refreshToken: async function() {
        try {
            const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
            
            if (!refreshToken) {
                throw new Error('No refresh token available');
            }
            
            console.log('Refreshing token with:', refreshToken);
            
            const response = await fetch(AUTH_API.REFRESH, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ refresh_token: refreshToken })
            });
            
            if (!response.ok) {
                console.error('Token refresh failed with status:', response.status);
                const errorData = await response.json();
                console.error('Error data:', errorData);
                this.logout();
                throw new Error(errorData.error || 'Token refresh failed');
            }
            
            const data = await response.json();
            console.log('Token refresh successful');
            
            // Save new tokens
            this.saveAuthData(data);
            
            return data;
        } catch (error) {
            console.error('Token refresh error:', error);
            throw error;
        }
    },
    
    /**
     * Check if token needs refreshing and refresh if needed
     */
    refreshTokenIfNeeded: async function() {
        try {
            const expiryTime = localStorage.getItem(STORAGE_KEYS.TOKEN_EXPIRY);
            
            if (!expiryTime) {
                return;
            }
            
            const now = Date.now();
            const expiry = parseInt(expiryTime);
            
            // Refresh if token expires in less than 5 minutes
            if (expiry - now < 300000) {
                await this.refreshToken();
            }
        } catch (error) {
            console.error('Token refresh check error:', error);
        }
    },
    
    /**
     * Save authentication data
     * @param {Object} data - Authentication data
     */
    saveAuthData: function(data) {
        if (data.access_token) {
            localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, data.access_token);
        }
        
        if (data.refresh_token) {
            localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, data.refresh_token);
        }
        
        if (data.expires_in) {
            const expiryTime = Date.now() + (data.expires_in * 1000);
            localStorage.setItem(STORAGE_KEYS.TOKEN_EXPIRY, expiryTime.toString());
        }
        
        // Save user info
        const userInfo = {
            user_id: data.user_id,
            email: data.email,
            name: data.name,
            role: data.role,
            subscription_tier: data.subscription_tier,
            email_verified: data.email_verified,
            profile_completed: data.profile_completed
        };
        
        localStorage.setItem(STORAGE_KEYS.USER_INFO, JSON.stringify(userInfo));
    },
    
    /**
     * Check if user is authenticated
     * @returns {boolean} Authentication status
     */
    isAuthenticated: function() {
        return !!this.getAccessToken();
    },
    
    /**
     * Get the current access token
     * @returns {string|null} Access token
     */
    getAccessToken: function() {
        return localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
    },
    
    
    /**
     * Get current user data
     * @returns {Object|null} User data
     */
    getCurrentUser: function() {
        const userInfoStr = localStorage.getItem(STORAGE_KEYS.USER_INFO);
        
        if (!userInfoStr) {
            return null;
        }
        
        
        try {
            return JSON.parse(userInfoStr);
        } catch (error) {
            console.error('Error parsing user info:', error);
            return null;
        }

    },
    
    /**
     * Update profile information
     * @param {Object} profileData - Profile data
     * @returns {Promise<Object>} Update result
    */
    updateProfile: async function(profileData) {
        try {
            const token = this.getAccessToken();
            
            if (!token) {
                throw new Error('Not authenticated');
            }
            
            const response = await fetch(AUTH_API.PROFILE, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(profileData)
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                console.log('failed at updateProfile');
                console.log(data.error);
                throw new Error(data.error || 'Profile update failed');
            }
            
            // Update stored user info
            const userInfo = this.getCurrentUser();
            
            if (userInfo) {
                userInfo.profile_completed = true;
                
                if (profileData.name) {
                    userInfo.name = profileData.name;
                }
                
                localStorage.setItem(STORAGE_KEYS.USER_INFO, JSON.stringify(userInfo));
            }
            
            // Update UI
            this.updateAuthUI();
            
            return data;
        } catch (error) {
            console.error('Profile update error:', error);
            throw error;
        }
    },
    
    /**
     * Update the UI based on authentication status
     */
    updateAuthUI: function() {
        const isAuthenticated = this.isAuthenticated();
        const userInfo = this.getCurrentUser();
        
        // Get UI elements
        const authSection = document.getElementById('auth-section');
        const loginButton = document.getElementById('login-button');
        const registerButton = document.getElementById('register-button');
        const logoutButton = document.getElementById('logout-button');
        const userNameDisplay = document.getElementById('user-name-display');
        const subscriptionBadge = document.getElementById('subscription-badge');
        const profileSection = document.getElementById('profile-section');
        const medicationHistory = document.getElementById('medication-history');
        
        if (!authSection) {
            return;
        }
        
        if (isAuthenticated && userInfo) {
            // User is logged in
            authSection.classList.remove('auth-logged-out');
            authSection.classList.add('auth-logged-in');
            
            // Update user display
            if (userNameDisplay) {
                userNameDisplay.textContent = userInfo.name || userInfo.email;
            }
            
            // Update subscription badge
            if (subscriptionBadge) {
                subscriptionBadge.textContent = userInfo.subscription_tier.toUpperCase();
                subscriptionBadge.className = `subscription-badge ${userInfo.subscription_tier}`;
            }
            
            // Show profile section if exists
            if (profileSection) {
                profileSection.style.display = 'block';
                this.populateProfileForm();
            }
            
            // Show medication history if exists
            if (medicationHistory) {
                medicationHistory.style.display = 'block';
            }
            
            // Hide anonymous limit info
            const anonLimitInfo = document.getElementById('anonymous-limit-info');
            if (anonLimitInfo) {
                anonLimitInfo.style.display = 'none';
            }
            
            // Show logout button, hide login/register
            if (loginButton) loginButton.style.display = 'none';
            if (registerButton) registerButton.style.display = 'none';
            if (logoutButton) logoutButton.style.display = 'inline-block';
        } else {
            // User is not logged in
            authSection.classList.remove('auth-logged-in');
            authSection.classList.add('auth-logged-out');
            
            // Hide user-specific sections
            if (profileSection) {
                profileSection.style.display = 'none';
            }
            
            if (medicationHistory) {
                medicationHistory.style.display = 'none';
            }
            
            // Show login/register buttons, hide logout
            if (loginButton) loginButton.style.display = 'inline-block';
            if (registerButton) registerButton.style.display = 'inline-block';
            if (logoutButton) logoutButton.style.display = 'none';
            
            // Check anonymous limit
            this.checkAnonymousLimit();
        }
    },
    
    /**
     * Populate profile form with user data
     */
    populateProfileForm: function() {
        const profileForm = document.getElementById('profile-form');
        if (!profileForm) return;
        
        const userInfo = this.getCurrentUser();
        if (!userInfo) return;
        
        // Get basic user data
        fetch(`/api/v1/auth/profile/${userInfo.user_id}`, {
            headers: {
                'Authorization': `Bearer ${this.getAccessToken()}`
            }
        })
        .then(response => response.json())
        .then(profileData => {
            // Populate form fields
            document.getElementById('profile-name').value = profileData.name || '';
            
            if (profileData.age) {
                document.getElementById('profile-age').value = profileData.age;
            }
            
            if (profileData.gender) {
                document.getElementById('profile-gender').value = profileData.gender;
            }
            
            if (profileData.zip_code) {
                document.getElementById('profile-zip').value = profileData.zip_code;
            }

            if (profileData.medication_history) {
                document.getElementById('profile-medication_history').value = profileData.medication_history;
            }
            
            // Handle allergies (array field)
            if (profileData.allergies && Array.isArray(profileData.allergies)) {
                document.getElementById('profile-allergies').value = profileData.allergies.join(', ');
            }
        })
        .catch(error => {
            console.error('Error fetching profile data:', error);
        });
    },
    
    /**
     * Check anonymous user request limit
     */
    checkAnonymousLimit: async function() {
        try {
            const response = await fetch(AUTH_API.ANON_LIMIT);
            
            if (!response.ok) {
                return;
            }
            
            const data = await response.json();
            
            // Update UI
            const limitElement = document.getElementById('anonymous-limit');
            const limitInfo = document.getElementById('anonymous-limit-info');
            
            if (limitElement && data.remaining !== undefined) {
                limitElement.textContent = data.remaining;
                
                // Show warning if low on requests
                if (data.remaining <= 1) {
                    limitElement.classList.add('limit-warning');
                } else {
                    limitElement.classList.remove('limit-warning');
                }
                
                // Show limit info
                if (limitInfo) {
                    limitInfo.style.display = 'block';
                }
            }
            
            return data;
        } catch (error) {
            console.error('Error checking anonymous limit:', error);
        }
    },
    
    /**
     * Show a notification message
     * @param {string} message - Notification message
     * @param {string} type - Notification type (success or error)
     */
    showNotification: function(message, type = 'success') {
        // Check if notification container exists
        let container = document.getElementById('notification-container');
        
        if (!container) {
            container = document.createElement('div');
            container.id = 'notification-container';
            document.body.appendChild(container);
        }
        
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Add close button
        const closeButton = document.createElement('button');
        closeButton.className = 'notification-close';
        closeButton.innerHTML = '&times;';
        closeButton.addEventListener('click', () => notification.remove());
        
        notification.appendChild(closeButton);
        container.appendChild(notification);
        
        // Auto remove after 5 seconds
        setTimeout(() => notification.remove(), 5000);
    }
};

// Initialize when all scripts are loaded
window.addEventListener('load', function() {
    // Initialize auth service
    AuthService.init();
    
    // Set up login form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async function(event) {
            event.preventDefault();
            
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            const errorElement = document.getElementById('login-error');
            
            try {
                await AuthService.login(email, password);
                
                // Initialize medication service after successful login
                if (window.MedicationService) {
                    console.log('Initializing medication service after login');
                    window.MedicationService.init();
                }
                
                // Hide modal
                document.getElementById('login-modal').style.display = 'none';
                
                // Reload page to reflect logged in state
                window.location.reload();
            } catch (error) {
                if (errorElement) {
                    errorElement.textContent = error.message || 'Login failed';
                }
            }
        });
    }
    
    // Set up registration form
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', async function(event) {
            event.preventDefault();
            
            const email = document.getElementById('register-email').value;
            const password = document.getElementById('register-password').value;
            const name = document.getElementById('register-name').value;
            const errorElement = document.getElementById('register-error');
            
            try {
                await AuthService.register({ email, password, name });
                
                // Hide modal
                document.getElementById('register-modal').style.display = 'none';
                
                // Reload page
                window.location.reload();
            } catch (error) {
                if (errorElement) {
                    errorElement.textContent = error.message || 'Registration failed';
                }
            }
        });
    }
    
    // Set up social login buttons
    document.querySelectorAll('.social-login-button').forEach(button => {
        button.addEventListener('click', function() {
            const provider = this.getAttribute('data-provider');
            if (provider) {
                AuthService.socialLogin(provider);
            }
        });
    });
    
    // Set up profile forms
    document.querySelectorAll('#profile-form, #profile-completion-form').forEach(form => {
        if (form) {
            form.addEventListener('submit', async function(event) {
                event.preventDefault();
                
                const profileData = {
                    name: this.querySelector('[name="name"]').value,
                    age: parseInt(this.querySelector('[name="age"]').value) || null,
                    gender: this.querySelector('[name="gender"]').value,
                    zip_code: this.querySelector('[name="zip_code"]').value,
                    medication_history: this.querySelector('[name="medication_history"]').value,
                };
                
                // Process allergies
                const allergiesField = this.querySelector('[name="allergies"]');
                if (allergiesField && allergiesField.value) {
                    profileData.allergies = allergiesField.value
                        .split(',')
                        .map(item => item.trim())
                        .filter(item => item);
                }
                
                const errorElement = this.querySelector('.error-message');
                const successElement = this.querySelector('.success-message');
                
                try {
                    await AuthService.updateProfile(profileData);
                    
                    // Show success message
                    if (successElement) {
                        successElement.textContent = 'Profile updated successfully';
                        successElement.style.display = 'block';
                        
                        // Hide after 3 seconds
                        setTimeout(() => {
                            successElement.style.display = 'none';
                        }, 3000);
                    }
                    
                    // Clear error
                    if (errorElement) {
                        errorElement.textContent = '';
                    }
                    
                    // If this is the profile completion form, close it
                    if (this.id === 'profile-completion-form') {
                        document.getElementById('profile-completion-modal').style.display = 'none';
                    }
                } catch (error) {
                    if (errorElement) {
                        errorElement.textContent = error.message || 'Profile update failed';
                    }
                    
                    // Hide success
                    if (successElement) {
                        successElement.style.display = 'none';
                    }
                }
            });
        }
    });
    
    // Set up logout button
    const logoutButton = document.getElementById('logout-button');
    if (logoutButton) {
        logoutButton.addEventListener('click', function() {
            AuthService.logout();
        });
    }
    
    // Modal controls
    // Show modals
    document.getElementById('login-button')?.addEventListener('click', function() {
        document.getElementById('login-modal').style.display = 'block';
    });
    
    document.getElementById('register-button')?.addEventListener('click', function() {
        document.getElementById('register-modal').style.display = 'block';
    });
    
    // Close modals
    document.querySelectorAll('.modal .close-button').forEach(button => {
        button.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) {
                // Don't close profile completion if required
                if (modal.id === 'profile-completion-modal') {
                    const userInfo = AuthService.getCurrentUser();
                    if (userInfo && !userInfo.profile_completed) {
                        return;
                    }
                }
                modal.style.display = 'none';
            }
        });
    });
    
    // Close when clicking outside
    window.addEventListener('click', function(event) {
        document.querySelectorAll('.modal').forEach(modal => {
            if (event.target === modal) {
                // Don't close profile completion if required
                if (modal.id === 'profile-completion-modal') {
                    const userInfo = AuthService.getCurrentUser();
                    if (userInfo && !userInfo.profile_completed) {
                        return;
                    }
                }
                modal.style.display = 'none';
            }
        });
    });
    
    // Links between modals
    document.getElementById('go-to-register')?.addEventListener('click', function(e) {
        e.preventDefault();
        document.getElementById('login-modal').style.display = 'none';
        document.getElementById('register-modal').style.display = 'block';
    });
    
    document.getElementById('go-to-login')?.addEventListener('click', function(e) {
        e.preventDefault();
        document.getElementById('register-modal').style.display = 'none';
        document.getElementById('login-modal').style.display = 'block';
    });

    // Add this to the end of the DOMContentLoaded event listener in auth.js

    // Delete account functionality
    const deleteAccountBtn = document.getElementById('delete-account-button');
    const deleteAccountModal = document.getElementById('delete-account-modal');
    const confirmDeleteBtn = document.getElementById('confirm-delete-button');
    const cancelDeleteBtn = document.getElementById('cancel-delete-button');

    if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener('click', function() {
            if (deleteAccountModal) {
                deleteAccountModal.style.display = 'block';
            }
        });
    }

    if (cancelDeleteBtn) {
        cancelDeleteBtn.addEventListener('click', function() {
            if (deleteAccountModal) {
                deleteAccountModal.style.display = 'none';
            }
        });
    }

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async function() {
            try {
                const token = AuthService.getAccessToken();
                
                if (!token) {
                    throw new Error('Not authenticated');
                }
                
                const response = await fetch('/api/v1/auth/delete-account', {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.error || 'Account deletion failed');
                }
                
                // Clear all auth data and reload page
                AuthService.logout();
                
                // Show success notification before reload
                AuthService.showNotification('Your account has been successfully deleted', 'success');
                
                // Short delay to show notification
                setTimeout(() => {
                    window.location.href = '/';
                }, 2000);
                
            } catch (error) {
                console.error('Error deleting account:', error);
                AuthService.showNotification(
                    error.message || 'Failed to delete account. Please try again later.',
                    'error'
                );
                
                // Close the modal
                if (deleteAccountModal) {
                    deleteAccountModal.style.display = 'none';
                }
            }
        });
    }

    // Add deleteAccount method to AuthService
    AuthService.deleteAccount = async function() {
        try {
            const token = this.getAccessToken();
            
            if (!token) {
                throw new Error('Not authenticated');
            }
            
            const response = await fetch('/api/v1/auth/delete-account', {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Account deletion failed');
            }
            
            // Clear all auth data
            this.logout();
            
            return data;
        } catch (error) {
            console.error('Error deleting account:', error);
            throw error;
        }
    };

    
});


// Export AuthService for use in other modules
window.AuthService = AuthService;