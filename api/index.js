// Frontend fetch example with proper error handling
const API_BASE_URL = 'https://youtubeserver-production-1b17.up.railway.app';
const MD5_HASH = '6bb8c2f529084cdbc037e4b801cc2ab4';

// Function to make API requests with proper error handling
async function makeAPIRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const defaultOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    // Don't include credentials for CORS requests
    credentials: 'omit'
  };
  
  const finalOptions = { ...defaultOptions, ...options };
  
  try {
    console.log('Making request to:', url);
    console.log('Request options:', finalOptions);
    
    const response = await fetch(url, finalOptions);
    
    console.log('Response status:', response.status);
    console.log('Response headers:', [...response.headers.entries()]);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`HTTP ${response.status}: ${errorData.error || response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Response data:', data);
    return data;
    
  } catch (error) {
    console.error('API request failed:', error);
    
    // Handle different types of errors
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error - check if the server is running and accessible');
    } else if (error.message.includes('CORS')) {
      throw new Error('CORS error - server may not be configured for cross-origin requests');
    } else {
      throw error;
    }
  }
}

// Search function
async function searchYouTube(query, pageToken = null) {
  return makeAPIRequest('/api/search', {
    method: 'POST',
    body: JSON.stringify({
      query,
      pageToken,
      md5Hash: MD5_HASH
    })
  });
}

// Get audio function
async function getAudioUrl(videoId) {
  return makeAPIRequest(`/api/audio/${videoId}`, {
    method: 'POST',
    body: JSON.stringify({
      md5Hash: MD5_HASH
    })
  });
}

// Health check function
async function checkServerHealth() {
  return makeAPIRequest('/api/health', {
    method: 'GET'
  });
}

// Example usage
async function testAPI() {
  try {
    // Test health check first
    console.log('Testing health check...');
    const health = await checkServerHealth();
    console.log('Health check successful:', health);
    
    // Test search
    console.log('Testing search...');
    const searchResults = await searchYouTube('javascript tutorial');
    console.log('Search successful:', searchResults);
    
    // Test audio (use first video from search)
    if (searchResults.videos && searchResults.videos.length > 0) {
      console.log('Testing audio fetch...');
      const audioData = await getAudioUrl(searchResults.videos[0].id);
      console.log('Audio fetch successful:', audioData);
    }
    
  } catch (error) {
    console.error('API test failed:', error);
  }
}

// Run test
testAPI();
