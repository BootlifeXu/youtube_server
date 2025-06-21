// api/index.js
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import ytdl from '@distube/ytdl-core';

const app = express();
const PORT = process.env.PORT || 3000;

// Enhanced CORS configuration
app.use(cors({
  origin: [
    'https://profound-marigold-230ee5.netlify.app',
    'http://localhost:3000',
    'http://localhost:5000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Add request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'YouTube Audio Server is running!',
    status: 'ok',
    time: new Date().toISOString(),
    endpoints: ['/api/health', '/health', '/api/status', '/status']
  });
});

// Health check routes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    time: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage() 
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  res.json({ 
    status: 'server running',
    version: '1.0.0',
    node: process.version 
  });
});

app.get('/status', (req, res) => {
  res.json({ status: 'online' });
});

// Get audio URL for a YouTube video
app.post('/api/audio/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const { md5Hash } = req.body;

  console.log(`Audio request for video: ${videoId}`);

  if (md5Hash !== '6bb8c2f529084cdbc037e4b801cc2ab4') {
    return res.status(403).json({ error: 'Invalid API key hash' });
  }

  try {
    console.log('Fetching video info...');
    const info = await ytdl.getInfo(videoId);
    const audioFormat = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });

    if (!audioFormat || !audioFormat.url) {
      console.log('No audio format found');
      return res.status(404).json({ error: 'Audio stream not found' });
    }

    console.log('Audio URL found successfully');
    res.json({ audioUrl: audioFormat.url });
  } catch (err) {
    console.error('Audio fetch error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve audio URL: ' + err.message });
  }
});

// YouTube Search Route
app.post('/api/search', async (req, res) => {
  const { query, pageToken, md5Hash } = req.body;

  console.log(`Search request: ${query}`);

  if (md5Hash !== '6bb8c2f529084cdbc037e4b801cc2ab4') {
    return res.status(403).json({ error: 'Invalid API key hash' });
  }

  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  try {
    let url = `https://www.googleapis.com/youtube/v3/search?key=AIzaSyD2o0roVVcvfCEseTsqyFI6J2gs68hNcdo&type=video&part=snippet&videoCategoryId=10&maxResults=10&q=${encodeURIComponent(query)}`;
    
    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }

    console.log('Making YouTube API request...');
    const response = await fetch(url, {
      timeout: 10000 // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`YouTube API returned ${response.status}: ${response.statusText}`);
    }

    const json = await response.json();

    if (json.error) {
      throw new Error(`YouTube API error: ${json.error.message}`);
    }

    const videos = json.items ? json.items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.default.url
    })) : [];

    console.log(`Found ${videos.length} videos`);

    res.json({
      videos,
      nextPageToken: json.nextPageToken || null,
      prevPageToken: json.prevPageToken || null
    });
  } catch (error) {
    console.error('Search API error:', error.message);
    res.status(500).json({ error: 'Search failed: ' + error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Server accessible at http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

export default app;
