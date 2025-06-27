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

// Enhanced CORS configuration
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range', 'Accept', 'Accept-Encoding'],
  exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
  credentials: false
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.options('*', cors(corsOptions));

// Core & Health Routes
app.get('/', (req, res) => res.status(200).json({ message: 'Server is up and running!' }));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));

// Database-driven Favorites API (unchanged)
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

// FIXED: Enhanced streaming with anti-bot measures
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  
  if (!ytdl.validateID(videoId)) {
    return res.status(400).send('Invalid YouTube Video ID');
  }

  try {
    // Set CORS headers
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Range, Accept, Accept-Encoding, Content-Type');
    res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    res.header('Content-Type', 'audio/mpeg');
    res.header('Accept-Ranges', 'bytes');
    res.header('Cache-Control', 'no-cache');
    
    console.log(`Streaming request for video: ${videoId}`);

    // Enhanced YTDL options to bypass bot detection
    const ytdlOptions = {
      filter: 'audioonly',
      quality: 'highestaudio',
      requestOptions: {
        headers: {
          // Mimic a real browser
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Cache-Control': 'max-age=0'
        }
      }
    };

    // Try to get video info first with retry logic
    let info;
    let retries = 3;
    
    for (let i = 0; i < retries; i++) {
      try {
        // Add delay between retries to avoid rate limiting
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000 * i));
        }
        
        info = await ytdl.getInfo(videoId, ytdlOptions);
        break; // Success, exit retry loop
      } catch (err) {
        console.log(`Attempt ${i + 1} failed:`, err.message);
        
        if (i === retries - 1) {
          // Last attempt failed
          if (err.message.includes('Sign in to confirm')) {
            console.error('YouTube bot detection triggered');
            return res.status(503).json({ 
              error: 'YouTube temporarily blocked access. Please try again later.',
              code: 'YOUTUBE_BOT_DETECTION'
            });
          } else if (err.message.includes('Video unavailable')) {
            return res.status(404).json({ 
              error: 'Video is unavailable or restricted',
              code: 'VIDEO_UNAVAILABLE'
            });
          } else {
            throw err; // Re-throw other errors
          }
        }
      }
    }

    if (!info) {
      return res.status(500).send('Failed to get video information');
    }

    // Create audio stream with enhanced options
    const audioStream = ytdl(videoId, ytdlOptions);

    // Enhanced error handling
    audioStream.on('error', (err) => {
      console.error('Audio Stream Error:', err.message);
      if (err.message.includes('Sign in to confirm')) {
        console.log('Bot detection during stream, attempting fallback...');
        if (!res.headersSent) {
          res.status(503).json({ 
            error: 'Stream temporarily unavailable due to YouTube restrictions',
            code: 'STREAM_BOT_DETECTION'
          });
        }
      } else if (!res.headersSent) {
        res.status(500).send('Error during audio streaming: ' + err.message);
      }
    });

    audioStream.on('response', (response) => {
      console.log('Audio stream response received, status:', response.statusCode);
    });

    audioStream.on('info', (info) => {
      console.log('Stream info:', info.videoDetails?.title || 'Unknown title');
    });

    // Pipe the audio stream
    audioStream.pipe(res);

    // Handle client disconnect
    req.on('close', () => {
      console.log('Client disconnected, destroying audio stream');
      audioStream.destroy();
    });

  } catch (err) {
    console.error('YTDL Error:', err);
    
    if (err.message.includes('Sign in to confirm')) {
      if (!res.headersSent) {
        res.status(503).json({ 
          error: 'YouTube has temporarily restricted access. This is usually temporary - please try again in a few minutes.',
          code: 'YOUTUBE_BOT_DETECTION',
          suggestion: 'Try a different video or wait a few minutes before trying again.'
        });
      }
    } else if (err.message.includes('Video unavailable')) {
      if (!res.headersSent) {
        res.status(404).json({ 
          error: 'This video is unavailable, private, or restricted in your region.',
          code: 'VIDEO_UNAVAILABLE'
        });
      }
    } else {
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Failed to process video: ' + err.message,
          code: 'PROCESSING_ERROR'
        });
      }
    }
  }
});

// Search endpoint (unchanged)
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
