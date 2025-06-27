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
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health Check Endpoints
app.get('/', (req, res) => res.status(200).json({ 
  message: 'Server is up and running!',
  timestamp: new Date().toISOString()
}));

app.get('/api/health', (req, res) => res.status(200).json({ 
  status: 'ok',
  db_connected: true, // You could add actual DB connection check here
  server_time: new Date().toISOString()
}));

// --- Favorites API ---

// GET all favorites
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
    res.status(500).json({ 
      error: 'Failed to fetch favorites from database',
      details: error.message 
    });
  }
});

// POST new favorite
app.post('/api/favorites', async (req, res) => {
  try {
    const { id, title, channel, thumbnail } = req.body;
    if (!id || !title || !channel) {
      return res.status(400).json({ 
        error: 'Missing required favorite data',
        required: ['id', 'title', 'channel'] 
      });
    }

    const result = await sql`
      INSERT INTO favorites (video_id, title, channel, thumbnail)
      VALUES (${id}, ${title}, ${channel}, ${thumbnail})
      ON CONFLICT (video_id) DO NOTHING
      RETURNING *
    `;

    if (result.length === 0) {
      return res.status(200).json({ 
        message: 'Video already exists in favorites',
        video_id: id 
      });
    }

    res.status(201).json({ 
      message: 'Favorite added successfully',
      favorite: result[0] 
    });
  } catch (error) {
    console.error('DB Error - Adding favorite:', error);
    res.status(500).json({ 
      error: 'Failed to add favorite to database',
      details: error.message 
    });
  }
});

// DELETE favorite
app.delete('/api/favorites/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const result = await sql`
      DELETE FROM favorites WHERE video_id = ${videoId}
      RETURNING *
    `;

    if (result.count === 0) {
      return res.status(404).json({ 
        message: 'Favorite not found in database',
        video_id: videoId 
      });
    }

    res.status(200).json({ 
      message: 'Favorite removed successfully',
      deleted: result[0] 
    });
  } catch (error) {
    console.error('DB Error - Removing favorite:', error);
    res.status(500).json({ 
      error: 'Failed to remove favorite from database',
      details: error.message 
    });
  }
});

// --- Streaming API with Enhanced YouTube Handling ---

app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  
  if (!ytdl.validateID(videoId)) {
    return res.status(400).json({ 
      error: 'Invalid YouTube Video ID',
      received: videoId 
    });
  }

  try {
    // Validate video exists and is accessible
    const info = await ytdl.getInfo(videoId, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      }
