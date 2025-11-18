const BASE_URL = '/api/v1/auth';

/**
 * A centralized API request function with built-in error handling,
 * authentication, and retry logic.
 *
 * @param {string} endpoint - The API endpoint to call.
 * @param {object} [options={}] - Optional request options (method, body, etc.).
 * @param {number} [retries=3] - The number of times to retry on failure.
 * @returns {Promise<any>} - The JSON response from the API.
 */
export async function apiRequest(endpoint, options = {}, retries = 3) {
  const url = `${BASE_URL}${endpoint}`;
  
  const token = window.AuthService?.getAccessToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config = {
    ...options,
    headers,
  };

  try {
    const response = await fetch(url, config);

    if (response.status === 401) {
      // Attempt to refresh the token
      const refreshed = await window.AuthService.refresh();
      if (refreshed) {
        // Retry the original request with the new token
        headers['Authorization'] = `Bearer ${window.AuthService.getAccessToken()}`;
        const newResponse = await fetch(url, { ...config, headers });
        if (!newResponse.ok) {
          throw new Error(`API request failed with status ${newResponse.status}`);
        }
        return newResponse.json();
      } else {
        // Force logout if refresh fails
        window.AuthService.logout();
        throw new Error('Session expired. Please log in again.');
      }
    }

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    return response.json();
  } catch (error) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
      return apiRequest(endpoint, options, retries - 1);
    }
    console.error('API Request Error:', error);
    throw error;
  }
} 