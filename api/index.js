const express = require('express');
const ytdl = require('@distube/ytdl-core');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();

// Enable CORS for all origins with specific headers
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

// Add CORS headers manually as well
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// Middleware
app.use(express.json());

// Your MD5 hash for validation
const VALID_MD5_HASH = '6bb8c2f529084cdbc037e4b801cc2ab4';

// Function to validate MD5 hash and convert to API key
function validateAndGetApiKey(md5Hash) {
  if (md5Hash !== VALID_MD5_HASH) {
    throw new Error('Invalid API key hash');
  }
  
  // Your actual YouTube API key (store this in environment variables)
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error('YouTube API key not configured');
  }
  
  return apiKey;
}

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'YouTube Audio Server API', 
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /search/:hash - Search YouTube videos with hash validation',
      'GET /download/:hash/:videoId - Get audio download URL',
      'GET /health - Health check'
    ]
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Search YouTube videos - Main route used by frontend
app.get('/search/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const { q: query, pageToken } = req.query;
    
    console.log('Search request received:', { hash, query, pageToken });
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }
    
    if (!hash) {
      return res.status(400).json({ error: 'Hash is required in URL path' });
    }
    
    // Validate MD5 hash and get API key
    let apiKey;
    try {
      apiKey = validateAndGetApiKey(hash);
    } catch (error) {
      console.error('Hash validation failed:', error.message);
      return res.status(403).json({ error: 'Invalid API key hash' });
    }
    
    const maxResults = 10;
    let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(query)}&maxResults=${maxResults}&key=${apiKey}`;
    
    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }
    
    console.log('Making YouTube API request...');
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      console.error('YouTube API error:', data);
      return res.status(response.status).json({ 
        error: data.error?.message || 'YouTube API error',
        details: data.error
      });
    }
    
    // Format the response to match frontend expectations
    const videos = data.items ? data.items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
      publishedAt: item.snippet.publishedAt
    })) : [];
    
    console.log(`Search successful: found ${videos.length} videos`);
    
    res.json({
      videos,
      nextPageToken: data.nextPageToken,
      prevPageToken: data.prevPageToken,
      totalResults: data.pageInfo?.totalResults
    });
    
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Get audio download URL
app.get('/download/:hash/:videoId', async (req, res) => {
  try {
    const { videoId, hash } = req.params;
    
    console.log('Download request received:', { videoId, hash });
    
    // Validate MD5 hash for security
    if (!hash || hash !== VALID_MD5_HASH) {
      console.error('Invalid hash provided:', hash);
      return res.status(403).json({ error: 'Invalid hash' });
    }
    
    if (!videoId) {
      return res.status(400).json({ error: 'Video ID is required' });
    }
    
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    try {
      console.log('Getting video info for:', videoUrl);
      
      // Get video info first
      const info = await ytdl.getInfo(videoUrl);
      
      // Filter only audio formats
      const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
      
      if (audioFormats.length === 0) {
        console.error('No audio formats found for video:', videoId);
        return res.status(404).json({ error: 'No audio stream found for this video' });
      }
      
      // Select best audio format (prefer highest bitrate)
      const bestAudio = audioFormats
        .filter(format => format.audioBitrate)
        .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0] || audioFormats[0];
      
      console.log('Best audio format selected:', {
        itag: bestAudio.itag,
        audioBitrate: bestAudio.audioBitrate,
        mimeType: bestAudio.mimeType
      });
      
      // Return the direct audio URL
      res.json({ 
        audio: bestAudio.url,
        title: info.videoDetails.title,
        duration: info.videoDetails.lengthSeconds,
        format: {
          audioBitrate: bestAudio.audioBitrate,
          mimeType: bestAudio.mimeType
        }
      });
      
    } catch (error) {
      console.error('Video info error:', error);
      
      // Handle specific ytdl errors
      if (error.message.includes('Video unavailable')) {
        return res.status(404).json({ error: 'Video is unavailable or private' });
      } else if (error.message.includes('No such video')) {
        return res.status(404).json({ error: 'Video not found' });
      } else {
        return res.status(500).json({ 
          error: 'Failed to get video info', 
          message: error.message 
        });
      }
    }
    
  } catch (error) {
    console.error('Audio extraction error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Catch-all route for debugging
app.use('*', (req, res) => {
  console.log('Unmatched route:', req.method, req.originalUrl);
  res.json({ 
    error: 'Route not found',
    method: req.method,
    url: req.originalUrl,
    availableRoutes: [
      'GET /',
      'GET /health',
      'GET /search/:hash',
      'GET /download/:hash/:videoId'
    ]
  });
});

// Export for Vercel
module.exports = app;