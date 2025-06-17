const express = require('express');
const crypto = require('crypto');
const path = require('path');
const ytdl = require('@distube/ytdl-core');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Your MD5 hash for validation
const VALID_MD5_HASH = '6bb8c2f529084cdbc037e4b801cc2ab4';

// Function to validate MD5 hash and convert to API key
function validateAndGetApiKey(md5Hash) {
  if (md5Hash !== VALID_MD5_HASH) {
    throw new Error('Invalid API key hash');
  }
  
  // Your actual YouTube API key (store this in secrets)
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
    endpoints: [
      'POST /api/search - Search YouTube videos',
      'GET /api/stream/:videoId - Stream audio',
      'POST /api/audio/:videoId - Get audio URL',
      'GET /search/:hash - Search with hash in URL'
    ]
  });
});

// Search YouTube videos - Updated route to match frontend
app.get('/search/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const { q: query, pageToken } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }
    
    if (!hash) {
      return res.status(400).json({ error: 'Hash is required' });
    }
    
    // Validate MD5 hash and get API key
    const apiKey = validateAndGetApiKey(hash);
    
    const maxResults = 10;
    let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(query)}&maxResults=${maxResults}&key=${apiKey}`;
    
    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'YouTube API error' });
    }
    
    // Format the response to match frontend expectations
    const videos = data.items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
      publishedAt: item.snippet.publishedAt
    }));
    
    res.json({
      videos,
      nextPageToken: data.nextPageToken,
      prevPageToken: data.prevPageToken
    });
    
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get audio download URL - Updated route to match frontend
app.get('/download/:hash/:videoId', async (req, res) => {
  try {
    const { videoId, hash } = req.params;
    
    // Validate MD5 hash for security
    if (!hash || hash !== VALID_MD5_HASH) {
      return res.status(403).json({ error: 'Invalid hash' });
    }
    
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    try {
      // Get video info first
      const info = await ytdl.getInfo(videoUrl);
      
      // Filter only audio formats
      const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
      
      if (audioFormats.length === 0) {
        return res.status(404).json({ error: 'No audio stream found' });
      }
      
      // Select best audio format
      const bestAudio = audioFormats.find(format => format.audioBitrate) || audioFormats[0];
      
      // Return the direct audio URL
      res.json({ 
        audio: bestAudio.url,
        title: info.videoDetails.title,
        duration: info.videoDetails.lengthSeconds
      });
      
    } catch (error) {
      console.error('Video info error:', error);
      res.status(500).json({ error: 'Failed to get video info: ' + error.message });
    }
    
  } catch (error) {
    console.error('Audio extraction error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Original POST route for search (keeping for compatibility)
app.post('/api/search', async (req, res) => {
  try {
    const { query, pageToken, md5Hash } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    if (!md5Hash) {
      return res.status(400).json({ error: 'MD5 hash is required' });
    }
    
    // Validate MD5 hash and get API key
    const apiKey = validateAndGetApiKey(md5Hash);
    
    const maxResults = 10;
    let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(query)}&maxResults=${maxResults}&key=${apiKey}`;
    
    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'YouTube API error' });
    }
    
    // Format the response
    const videos = data.items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
      publishedAt: item.snippet.publishedAt
    }));
    
    res.json({
      videos,
      nextPageToken: data.nextPageToken,
      prevPageToken: data.prevPageToken
    });
    
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stream audio directly from YouTube
app.get('/api/stream/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const { hash } = req.query;
    
    // Validate MD5 hash for security
    if (!hash || hash !== VALID_MD5_HASH) {
      return res.status(403).json({ error: 'Invalid hash' });
    }
    
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    try {
      // Get video info first with better error handling
      const info = await ytdl.getInfo(videoUrl);
      
      // Filter only audio formats
      const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
      
      if (audioFormats.length === 0) {
        return res.status(404).json({ error: 'No audio stream found' });
      }
      
      // Select best audio format (use the highest quality available)
      const bestAudio = audioFormats.find(format => format.audioBitrate) || audioFormats[0];
      
      // Set headers for audio streaming
      res.setHeader('Content-Type', bestAudio.mimeType || 'audio/webm');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');
      
      // Create audio stream from the selected format
      const audioStream = ytdl(videoUrl, {
        quality: 'highestaudio',
        filter: 'audioonly',
        format: bestAudio,
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        }
      });
      
      // Pipe the audio stream directly to the response
      audioStream.pipe(res);
      
      audioStream.on('error', (error) => {
        console.error('Stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Streaming failed: ' + error.message });
        }
      });
      
      res.on('close', () => {
        audioStream.destroy();
      });
      
    } catch (error) {
      console.error('Video info error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to get video info: ' + error.message });
      }
    }
    
  } catch (error) {
    console.error('Audio streaming error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Get audio stream URL (returns our streaming endpoint)
app.post('/api/audio/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const { md5Hash } = req.body;
    
    if (!md5Hash) {
      return res.status(400).json({ error: 'MD5 hash is required' });
    }
    
    // Validate MD5 hash
    validateAndGetApiKey(md5Hash);
    
    // Return our streaming endpoint
    const audioUrl = `/api/stream/${videoId}?hash=${md5Hash}`;
    
    res.json({ audioUrl });
    
  } catch (error) {
    console.error('Audio extraction error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Export the app for Vercel
module.exports = app;

// Only listen if not in Vercel environment
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}
