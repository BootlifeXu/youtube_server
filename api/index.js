import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import ytdl from '@distube/ytdl-core';
import postgres from 'postgres';

// Initialize PostgreSQL connection
const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  idle_timeout: 20,
  max_lifetime: 60 * 30
});

const app = express();
const PORT = process.env.PORT || 8080;

// Enhanced middleware setup
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection health check
app.get('/api/db-health', async (req, res) => {
  try {
    await sql`SELECT 1`;
    res.status(200).json({ status: 'healthy' });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});

// Core routes
app.get('/', (req, res) => res.status(200).json({ 
  message: 'YouTube Music Server', 
  status: 'running',
  version: '1.1.0'
}));

app.get('/api/health', (req, res) => res.status(200).json({ 
  status: 'ok',
  timestamp: new Date().toISOString()
}));

// Folder API Endpoints
app.get('/api/folders', async (req, res) => {
  try {
    const folders = await sql`
      SELECT id, name, created_at 
      FROM folders 
      ORDER BY name
    `;
    res.status(200).json(folders);
  } catch (error) {
    console.error('DB Error - Fetching folders:', error);
    res.status(500).json({ 
      error: 'Failed to fetch folders',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/folders', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Folder name is required and must be a non-empty string' 
      });
    }
    
    const trimmedName = name.trim();
    
    // Check for duplicate folder names (case-insensitive)
    const existingFolder = await sql`
      SELECT id FROM folders WHERE LOWER(name) = LOWER(${trimmedName}) LIMIT 1
    `;
    
    if (existingFolder.length > 0) {
      return res.status(409).json({ 
        error: 'A folder with this name already exists' 
      });
    }
    
    const [folder] = await sql`
      INSERT INTO folders (name) 
      VALUES (${trimmedName}) 
      RETURNING id, name, created_at
    `;
    
    res.status(201).json(folder);
  } catch (error) {
    console.error('DB Error - Creating folder:', error);
    res.status(500).json({ 
      error: 'Failed to create folder',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.put('/api/folders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Folder name is required and must be a non-empty string' 
      });
    }
    
    const trimmedName = name.trim();
    
    // Check if folder exists
    const folderExists = await sql`
      SELECT id FROM folders WHERE id = ${id} LIMIT 1
    `;
    
    if (folderExists.length === 0) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    
    // Check for duplicate names (excluding current folder)
    const duplicateFolder = await sql`
      SELECT id FROM folders 
      WHERE LOWER(name) = LOWER(${trimmedName}) AND id != ${id} 
      LIMIT 1
    `;
    
    if (duplicateFolder.length > 0) {
      return res.status(409).json({ 
        error: 'Another folder with this name already exists' 
      });
    }
    
    const [folder] = await sql`
      UPDATE folders 
      SET name = ${trimmedName} 
      WHERE id = ${id} 
      RETURNING id, name, created_at
    `;
    
    res.status(200).json(folder);
  } catch (error) {
    console.error('DB Error - Updating folder:', error);
    res.status(500).json({ 
      error: 'Failed to update folder',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.delete('/api/folders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verify folder exists
    const folderExists = await sql`
      SELECT id FROM folders WHERE id = ${id} LIMIT 1
    `;
    
    if (folderExists.length === 0) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    
    // Move all favorites to uncategorized
    await sql`
      UPDATE favorites SET folder_id = NULL WHERE folder_id = ${id}
    `;
    
    // Delete the folder
    const result = await sql`
      DELETE FROM folders WHERE id = ${id}
    `;
    
    res.status(200).json({ 
      message: 'Folder deleted successfully',
      favoritesUpdated: result.count
    });
  } catch (error) {
    console.error('DB Error - Deleting folder:', error);
    res.status(500).json({ 
      error: 'Failed to delete folder',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Favorites API Endpoints
app.get('/api/favorites', async (req, res) => {
  try {
    const favorites = await sql`
      SELECT 
        f.id as favorite_id,
        f.video_id as id,
        f.title,
        f.channel,
        f.thumbnail,
        f.folder_id,
        fo.name as folder_name,
        f.created_at
      FROM favorites f
      LEFT JOIN folders fo ON f.folder_id = fo.id
      ORDER BY COALESCE(fo.name, ''), f.title
    `;
    res.status(200).json(favorites);
  } catch (error) {
    console.error('DB Error - Fetching favorites:', error);
    res.status(500).json({ 
      error: 'Failed to fetch favorites',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/favorites', async (req, res) => {
  try {
    const { id, title, channel, thumbnail, folderId } = req.body;
    
    if (!id || !title || !channel) {
      return res.status(400).json({ 
        error: 'Missing required fields: id, title, and channel are required' 
      });
    }
    
    // Validate folderId if provided
    if (folderId) {
      const folderExists = await sql`
        SELECT id FROM folders WHERE id = ${folderId} LIMIT 1
      `;
      
      if (folderExists.length === 0) {
        return res.status(400).json({ error: 'Specified folder does not exist' });
      }
    }
    
    const [favorite] = await sql`
      INSERT INTO favorites (video_id, title, channel, thumbnail, folder_id)
      VALUES (${id}, ${title}, ${channel}, ${thumbnail || null}, ${folderId || null})
      ON CONFLICT (video_id) DO UPDATE 
      SET 
        title = EXCLUDED.title,
        channel = EXCLUDED.channel,
        thumbnail = EXCLUDED.thumbnail,
        folder_id = EXCLUDED.folder_id
      RETURNING 
        id as favorite_id,
        video_id as id,
        title,
        channel,
        thumbnail,
        folder_id,
        created_at
    `;
    
    res.status(201).json(favorite);
  } catch (error) {
    console.error('DB Error - Adding favorite:', error);
    res.status(500).json({ 
      error: 'Failed to add favorite',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.delete('/api/favorites/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    
    const result = await sql`
      DELETE FROM favorites WHERE video_id = ${videoId}
    `;
    
    if (result.count === 0) {
      return res.status(404).json({ message: 'Favorite not found' });
    }
    
    res.status(200).json({ 
      message: 'Favorite removed successfully',
      deletedCount: result.count
    });
  } catch (error) {
    console.error('DB Error - Removing favorite:', error);
    res.status(500).json({ 
      error: 'Failed to remove favorite',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Media Streaming Endpoint
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  
  if (!ytdl.validateID(videoId)) {
    return res.status(400).json({ error: 'Invalid YouTube Video ID' });
  }
  
  try {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    
    const audioStream = ytdl(videoId, { 
      filter: 'audioonly', 
      quality: 'highestaudio',
      highWaterMark: 1 << 25 // 32MB buffer
    });
    
    audioStream.on('error', (err) => {
      console.error('Stream Error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error during audio streaming' });
      }
    });
    
    audioStream.pipe(res);
  } catch (err) {
    console.error('YTDL Initiation Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to initiate audio stream' });
    }
  }
});

// Search Endpoint
app.post('/api/search', async (req, res) => {
  const { query, pageToken, md5Hash } = req.body;
  
  // API key validation
  if (md5Hash !== '6bb8c2f529084cdbc037e4b801cc2ab4') {
    return res.status(403).json({ error: 'Invalid API key hash' });
  }
  
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'Search query is required' });
  }
  
  try {
    const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
    if (!YOUTUBE_API_KEY) {
      console.error('YouTube API Key is missing');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    
    const apiUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    apiUrl.searchParams.append('key', YOUTUBE_API_KEY);
    apiUrl.searchParams.append('type', 'video');
    apiUrl.searchParams.append('part', 'snippet');
    apiUrl.searchParams.append('videoCategoryId', '10'); // Music category
    apiUrl.searchParams.append('maxResults', '10');
    apiUrl.searchParams.append('q', encodeURIComponent(query.trim()));
    
    if (pageToken) {
      apiUrl.searchParams.append('pageToken', pageToken);
    }
    
    const response = await fetch(apiUrl.toString());
    const json = await response.json();
    
    if (json.error) {
      console.error('YouTube API Error:', json.error.message);
      return res.status(500).json({ 
        error: 'Failed to fetch from YouTube API',
        details: json.error.message
      });
    }
    
    const videos = json.items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.default?.url || ''
    }));
    
    res.json({
      videos,
      nextPageToken: json.nextPageToken || null,
      prevPageToken: json.prevPageToken || null,
      totalResults: json.pageInfo?.totalResults || 0
    });
  } catch (error) {
    console.error('Search API error:', error);
    res.status(500).json({ 
      error: 'Search failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Graceful shutdown handler
const gracefulShutdown = (signal) => {
  return () => {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    
    // Close the server first
    server.close(async () => {
      console.log('HTTP server closed');
      
      // Close database connection
      try {
        await sql.end();
        console.log('Database connection closed');
        process.exit(0);
      } catch (dbError) {
        console.error('Error closing database connection:', dbError);
        process.exit(1);
      }
    });
    
    // Force shutdown after 8 seconds
    setTimeout(() => {
      console.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 8000);
  };
};

// Start the server
const server = app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown('SIGTERM'));
process.on('SIGINT', gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException')();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
