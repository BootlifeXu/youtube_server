import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import ytdl from '@distube/ytdl-core';
import postgres from 'postgres';

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Enhanced CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));

// Middleware to ensure JSON responses
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

// Database Connection with error handling
let sql;
try {
  sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
  console.log('✅ Database connected');
} catch (err) {
  console.error('❌ Database connection failed:', err);
  process.exit(1);
}

// Health Check
app.get('/api/health', async (req, res) => {
  try {
    // Test database connection
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

// Stream Endpoint with improved error handling
app.get('/api/stream/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    
    if (!ytdl.validateID(videoId)) {
      return res.status(400).json({ error: 'Invalid YouTube Video ID' });
    }

    const info = await ytdl.getInfo(videoId, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      }
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    const audioStream = ytdl(videoId, {
      filter: 'audioonly',
      quality: 'highestaudio',
      requestOptions: { headers: info.requestOptions.headers }
    });

    audioStream.pipe(res);
    audioStream.on('error', (err) => {
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

// Error handling middleware (MUST be last)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
