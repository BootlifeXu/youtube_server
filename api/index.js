// api/index.js

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import ytdl from '@distube/ytdl-core';
import postgres from 'postgres';

// Database Connection
const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
});

const app = express();
const PORT = process.env.PORT || 3000;

// Enhanced CORS configuration for media streaming
const corsOptions = {
  origin: '*', // Allow all origins for now
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range', 'Accept', 'Accept-Encoding'],
  exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
  credentials: false
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Handle preflight requests
app.options('*', cors(corsOptions));

// Core & Health Routes
app.get('/', (req, res) => res.status(200).json({ message: 'Server is up and running!' }));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));

// Database-driven Favorites API
app.get('/api/favorites', async (req, res) => {
  try {
    const favorites = await sql`SELECT * FROM favorites ORDER BY created_at DESC`;
    const formattedFavorites = favorites.map(fav => ({
        id: fav.video_id,
        title: fav.title,
        channel: fav.channel,
        thumbnail: fav.thumbnail
    }));
    res.status(200).json(formattedFavorites);
  } catch (error) {
    console.error('DB Error - Fetching favorites:', error);
    res.status(500).json({ error: 'Failed to fetch favorites from database' });
  }
});

app.post('/api/favorites', async (req, res) => {
  try {
    const { id, title, channel, thumbnail } = req.body;
    if (!id || !title || !channel) {
      return res.status(400).json({ error: 'Missing required favorite data (id, title, channel)' });
    }
    await sql`
      INSERT INTO favorites (video_id, title, channel, thumbnail)
      VALUES (${id}, ${title}, ${channel}, ${thumbnail})
      ON CONFLICT (video_id) DO NOTHING
    `;
    res.status(201).json({ message: 'Favorite added successfully' });
  } catch (error) {
    console.error('DB Error - Adding favorite:', error);
    res.status(500).json({ error: 'Failed to add favorite to database' });
  }
});

app.delete('/api/favorites/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const result = await sql`
      DELETE FROM favorites WHERE video_id = ${videoId}
    `;
    if (result.count === 0) {
        return res.status(404).json({ message: 'Favorite not found in database' });
    }
    res.status(200).json({ message: 'Favorite removed successfully' });
  } catch (error) {
    console.error('DB Error - Removing favorite:', error);
    res.status(500).json({ error: 'Failed to remove favorite from database' });
  }
});

// FIXED: Enhanced streaming endpoint with proper CORS and headers
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  
  if (!ytdl.validateID(videoId)) {
    return res.status(400).send('Invalid YouTube Video ID');
  }

  try {
    // Set CORS headers explicitly for media streaming
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Range, Accept, Accept-Encoding, Content-Type');
    res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    
    // Set proper headers for audio streaming
    res.header('Content-Type', 'audio/mpeg');
    res.header('Accept-Ranges', 'bytes');
    res.header('Cache-Control', 'no-cache');
    
    // Handle range requests for better streaming support
    const range = req.headers.range;
    
    console.log(`Streaming request for video: ${videoId}`);
    
    // Get video info first to check if it's available
    const info = await ytdl.getInfo(videoId);
    if (!info) {
      return res.status(404).send('Video not found or unavailable');
    }

    const audioStream = ytdl(videoId, { 
      filter: 'audioonly', 
      quality: 'highestaudio',
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      }
    });

    // Set up error handling before piping
    audioStream.on('error', (err) => {
      console.error('Audio Stream Error:', err);
      if (!res.headersSent) {
        res.status(500).send('Error during audio streaming');
      }
    });

    audioStream.on('response', (response) => {
      console.log('Audio stream response received, status:', response.statusCode);
    });

    // Pipe the audio stream to response
    audioStream.pipe(res);

    // Handle client disconnect
    req.on('close', () => {
      console.log('Client disconnected, destroying audio stream');
      audioStream.destroy();
    });

  } catch (err) {
    console.error('YTDL Error:', err);
    if (!res.headersSent) {
      res.status(500).send('Failed to initiate audio stream: ' + err.message);
    }
  }
});

// Search endpoint
app.post('/api/search', async (req, res) => {
  const { query, pageToken, md5Hash } = req.body;
  
  if (md5Hash !== '6bb8c2f529084cdbc037e4b801cc2ab4') {
    return res.status(403).json({ error: 'Invalid API key hash' });
  }

  try {
    const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY; 
    if (!YOUTUBE_API_KEY) {
      console.error('YouTube API Key is missing from environment variables');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    let apiUrl = `https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_API_KEY}&type=video&part=snippet&videoCategoryId=10&maxResults=10&q=${encodeURIComponent(query)}`;
    if (pageToken) apiUrl += `&pageToken=${pageToken}`;

    const response = await fetch(apiUrl);
    const json = await response.json();

    if (json.error) {
      console.error('YouTube API Error:', json.error.message);
      return res.status(500).json({ error: 'Failed to fetch from YouTube API' });
    }

    const videos = json.items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.default.url
    }));

    res.json({ 
      videos, 
      nextPageToken: json.nextPageToken || null, 
      prevPageToken: json.prevPageToken || null 
    });
  } catch (error) {
    console.error('Search API error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
