// api/index.js - Fixed Version

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import ytdl from '@distube/ytdl-core';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
});

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());

// Test database connection
async function testDatabaseConnection() {
  try {
    await sql`SELECT 1`;
    console.log('✅ Database connected successfully');
    
    // Create tables if they don't exist
    await sql`
      CREATE TABLE IF NOT EXISTS folders (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    await sql`
      CREATE TABLE IF NOT EXISTS favorites (
        id SERIAL PRIMARY KEY,
        video_id VARCHAR(20) NOT NULL UNIQUE,
        title TEXT NOT NULL,
        channel TEXT NOT NULL,
        thumbnail TEXT,
        folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    console.log('✅ Database tables ensured');
    
  } catch (error) {
    console.error('❌ Database connection failed:', error);
  }
}

// Create a new router instance for our API
const api = express.Router();

// --- Core & Health Routes ---
api.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString() 
  });
});

// --- Folder CRUD Operations ---
api.get('/folders', async (req, res) => {
  try {
    console.log('GET /api/folders called');
    const folders = await sql`SELECT * FROM folders ORDER BY name`;
    console.log('Folders fetched:', folders.length);
    res.status(200).json(folders);
  } catch (error) {
    console.error('DB Error - Fetching folders:', error);
    res.status(500).json({ error: 'Failed to fetch folders from database' });
  }
});

api.post('/folders', async (req, res) => {
  try {
    console.log('POST /api/folders called with:', req.body);
    const { name } = req.body;
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Folder name is required' });
    }
    
    const trimmedName = name.trim();
    const [folder] = await sql`
      INSERT INTO folders (name) 
      VALUES (${trimmedName}) 
      RETURNING *
    `;
    console.log('Folder created:', folder);
    res.status(201).json(folder);
  } catch (error) {
    console.error('DB Error - Creating folder:', error);
    if (error.code === '23505') { // Unique constraint violation
      res.status(409).json({ error: 'Folder with this name already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create folder' });
    }
  }
});

api.put('/folders/:id', async (req, res) => {
  try {
    console.log('PUT /api/folders/:id called with:', req.params.id, req.body);
    const { id } = req.params;
    const { name } = req.body;
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Folder name is required' });
    }
    
    const trimmedName = name.trim();
    const [folder] = await sql`
      UPDATE folders 
      SET name = ${trimmedName}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id} 
      RETURNING *
    `;
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    console.log('Folder updated:', folder);
    res.status(200).json(folder);
  } catch (error) {
    console.error('DB Error - Updating folder:', error);
    if (error.code === '23505') { // Unique constraint violation
      res.status(409).json({ error: 'Folder with this name already exists' });
    } else {
      res.status(500).json({ error: 'Failed to update folder' });
    }
  }
});

api.delete('/folders/:id', async (req, res) => {
  try {
    console.log('DELETE /api/folders/:id called with:', req.params.id);
    const { id } = req.params;
    
    // First, update any favorites that reference this folder
    await sql`UPDATE favorites SET folder_id = NULL WHERE folder_id = ${id}`;
    
    // Then delete the folder
    const result = await sql`DELETE FROM folders WHERE id = ${id}`;
    if (result.count === 0) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    console.log('Folder deleted:', id);
    res.status(200).json({ message: 'Folder deleted successfully' });
  } catch (error) {
    console.error('DB Error - Deleting folder:', error);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// --- Favorites API Routes ---
api.get('/favorites', async (req, res) => {
  try {
    console.log('GET /api/favorites called');
    const favorites = await sql`
      SELECT 
        f.id as favorite_id,
        f.video_id as id,
        f.title,
        f.channel,
        f.thumbnail,
        f.folder_id,
        fo.name as folder_name
      FROM favorites f
      LEFT JOIN folders fo ON f.folder_id = fo.id
      ORDER BY COALESCE(fo.name, ''), f.title
    `;
    console.log('Favorites fetched:', favorites.length);
    res.status(200).json(favorites);
  } catch (error) {
    console.error('DB Error - Fetching favorites:', error);
    res.status(500).json({ error: 'Failed to fetch favorites from database' });
  }
});

api.post('/favorites', async (req, res) => {
  try {
    console.log('POST /api/favorites called with:', req.body);
    const { id, title, channel, thumbnail, folderId } = req.body;
    if (!id || !title || !channel) {
      return res.status(400).json({ error: 'Missing required favorite data' });
    }
    
    // Validate YouTube video ID
    if (!ytdl.validateID(id)) {
      return res.status(400).json({ error: 'Invalid YouTube video ID' });
    }
    
    const result = await sql`
      INSERT INTO favorites (video_id, title, channel, thumbnail, folder_id)
      VALUES (${id}, ${title}, ${channel}, ${thumbnail || null}, ${folderId || null})
      ON CONFLICT (video_id) DO UPDATE 
      SET 
        folder_id = EXCLUDED.folder_id,
        title = EXCLUDED.title,
        channel = EXCLUDED.channel,
        thumbnail = EXCLUDED.thumbnail,
        updated_at = CURRENT_TIMESTAMP
    `;
    console.log('Favorite added/updated:', id);
    res.status(201).json({ message: 'Favorite added successfully' });
  } catch (error) {
    console.error('DB Error - Adding favorite:', error);
    res.status(500).json({ error: 'Failed to add favorite to database' });
  }
});

api.delete('/favorites/:videoId', async (req, res) => {
  try {
    console.log('DELETE /api/favorites/:videoId called with:', req.params.videoId);
    const { videoId } = req.params;
    const result = await sql`DELETE FROM favorites WHERE video_id = ${videoId}`;
    if (result.count === 0) {
      return res.status(404).json({ message: 'Favorite not found' });
    }
    console.log('Favorite removed:', videoId);
    res.status(200).json({ message: 'Favorite removed successfully' });
  } catch (error) {
    console.error('DB Error - Removing favorite:', error);
    res.status(500).json({ error: 'Failed to remove favorite from database' });
  }
});

// --- Streaming Route ---
api.get('/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  console.log('Stream requested for video:', videoId);
  
  if (!ytdl.validateID(videoId)) {
    return res.status(400).json({ error: 'Invalid YouTube Video ID' });
  }
  
  try {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    
    const audioStream = ytdl(videoId, { 
      filter: 'audioonly', 
      quality: 'highestaudio' 
    });
    
    audioStream.pipe(res);
    
    audioStream.on('error', (err) => {
      console.error('Stream Error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error during streaming' });
      }
    });
    
    audioStream.on('end', () => {
      console.log('Stream ended for video:', videoId);
    });
    
  } catch (err) {
    console.error('YTDL Initiation Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to initiate audio stream' });
    }
  }
});

// --- Search Route ---
api.post('/search', async (req, res) => {
  try {
    console.log('POST /api/search called with:', req.body);
    const { query, pageToken, md5Hash } = req.body;
    
    if (md5Hash !== '6bb8c2f529084cdbc037e4b801cc2ab4') {
      return res.status(403).json({ error: 'Invalid API key hash' });
    }
    
    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
    if (!YOUTUBE_API_KEY) {
      console.error('Missing YouTube API Key');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    
    let apiUrl = `https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_API_KEY}&type=video&part=snippet&videoCategoryId=10&maxResults=10&q=${encodeURIComponent(query.trim())}`;
    if (pageToken) {
      apiUrl += `&pageToken=${pageToken}`;
    }
    
    console.log('Calling YouTube API...');
    const response = await fetch(apiUrl);
    const json = await response.json();
    
    if (json.error) {
      console.error('YouTube API Error:', json.error);
      return res.status(500).json({ error: 'Failed to fetch from YouTube API' });
    }
    
    const videos = (json.items || []).map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.default.url
    }));
    
    console.log('Search results:', videos.length, 'videos found');
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

// Tell the main 'app' to use our 'api' router for any path that starts with '/api'
app.use('/api', api);

// A root route on the main app for basic checks
app.get('/', (req, res) => {
  res.status(200).json({ 
    message: 'YouTube Music Player API Server',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  console.log('404 - Route not found:', req.method, req.originalUrl);
  res.status(404).json({ error: 'Route not found' });
});

// Start the server
async function startServer() {
  try {
    await testDatabaseConnection();
    
    const server = app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
    });
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Server closed');
        sql.end();
        process.exit(0);
      });
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
