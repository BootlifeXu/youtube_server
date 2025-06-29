import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import ytdl from '@distube/ytdl-core';
import postgres from 'postgres';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3000;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const ALLOWED_MD5 = '6bb8c2f529084cdbc037e4b801cc2ab4'; // MD5 of real key

// --- Middleware ---
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// --- PostgreSQL ---
let sql;
try {
  sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
  console.log('✅ Database connected');
  
  // Initialize favorites table on startup
  initDatabase();
} catch (err) {
  console.error('❌ Database connection failed:', err);
  process.exit(1);
}

// --- Initialize Database Tables ---
async function initDatabase() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS favorites (
        id VARCHAR(20) PRIMARY KEY,
        title TEXT NOT NULL,
        channel TEXT NOT NULL,
        thumbnail TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Database tables initialized');
  } catch (err) {
    console.error('❌ Failed to initialize database tables:', err);
  }
}

// --- /api/health ---
app.get('/api/health', async (req, res) => {
  try {
    await sql`SELECT 1`;
    res.status(200).json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      database: 'disconnected',
      error: err.message
    });
  }
});

// --- /api/search ---
app.post('/api/search', async (req, res) => {
  const { query, pageToken, md5Hash } = req.body;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid query' });
  }

  const computedHash = crypto.createHash('md5').update(YOUTUBE_API_KEY).digest('hex');
  if (computedHash !== md5Hash) {
    return res.status(401).json({ error: 'Unauthorized or invalid key hash' });
  }

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('maxResults', '10');
    url.searchParams.set('q', query);
    url.searchParams.set('type', 'video');
    url.searchParams.set('key', YOUTUBE_API_KEY);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: 'YouTube API error', details: data });
    }

    const videos = data.items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.default.url
    }));

    res.json({
      videos,
      nextPageToken: data.nextPageToken || null,
      prevPageToken: data.prevPageToken || null
    });

  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Failed to fetch YouTube data', details: err.message });
  }
});

// --- /api/stream/:videoId ---
app.get('/api/stream/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;

    if (!ytdl.validateID(videoId)) {
      return res.status(400).json({ error: 'Invalid YouTube Video ID' });
    }

    const info = await ytdl.getInfo(videoId, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      }
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    const stream = ytdl(videoId, {
      filter: 'audioonly',
      quality: 'highestaudio',
      requestOptions: { headers: info.requestOptions.headers }
    });

    stream.pipe(res);
    stream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Stream error', details: err.message });
      }
    });

  } catch (err) {
    console.error('Stream error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to stream audio',
        details: err.message,
        youtubeError: err.message.includes('confirm you are not a robot')
          ? 'YouTube requires verification'
          : null
      });
    }
  }
});

// --- ⭐ NEW FAVORITES API ENDPOINTS ⭐ ---

// GET /api/favorites - Fetch all favorites
app.get('/api/favorites', async (req, res) => {
  try {
    const favorites = await sql`
      SELECT id, title, channel, thumbnail, created_at 
      FROM favorites 
      ORDER BY created_at DESC
    `;
    
    res.json(favorites);
  } catch (err) {
    console.error('Fetch favorites error:', err);
    res.status(500).json({ 
      error: 'Failed to fetch favorites', 
      details: err.message 
    });
  }
});

// POST /api/favorites - Add a new favorite
app.post('/api/favorites', async (req, res) => {
  const { id, title, channel, thumbnail } = req.body;

  // Validation
  if (!id || !title || !channel) {
    return res.status(400).json({ 
      error: 'Missing required fields: id, title, channel' 
    });
  }

  if (typeof id !== 'string' || id.length > 20) {
    return res.status(400).json({ 
      error: 'Invalid video ID format' 
    });
  }

  try {
    // Check if already exists
    const existing = await sql`
      SELECT id FROM favorites WHERE id = ${id}
    `;

    if (existing.length > 0) {
      return res.status(409).json({ 
        error: 'Video already in favorites' 
      });
    }

    // Insert new favorite
    await sql`
      INSERT INTO favorites (id, title, channel, thumbnail)
      VALUES (${id}, ${title}, ${channel}, ${thumbnail || null})
    `;

    res.status(201).json({ 
      message: 'Added to favorites successfully',
      favorite: { id, title, channel, thumbnail }
    });

  } catch (err) {
    console.error('Add favorite error:', err);
    res.status(500).json({ 
      error: 'Failed to add favorite', 
      details: err.message 
    });
  }
});

// DELETE /api/favorites/:id - Remove a favorite
app.delete('/api/favorites/:id', async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Missing video ID' });
  }

  try {
    const result = await sql`
      DELETE FROM favorites WHERE id = ${id}
    `;

    if (result.count === 0) {
      return res.status(404).json({ 
        error: 'Favorite not found' 
      });
    }

    res.json({ 
      message: 'Removed from favorites successfully' 
    });

  } catch (err) {
    console.error('Remove favorite error:', err);
    res.status(500).json({ 
      error: 'Failed to remove favorite', 
      details: err.message 
    });
  }
});

// --- Catch-all 404 for unknown /api routes ---
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// --- Global error handler ---
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
