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

// Middleware
app.use(cors());
app.use(express.json());

// Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Stream Endpoint
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  
  if (!ytdl.validateID(videoId)) {
    return res.status(400).json({ error: 'Invalid YouTube Video ID' });
  }

  try {
    res.setHeader('Content-Type', 'audio/mpeg');
    const audioStream = ytdl(videoId, {
      filter: 'audioonly',
      quality: 'highestaudio',
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      }
    });

    audioStream.pipe(res);
    audioStream.on('error', (err) => {
      console.error('Stream Error:', err);
      if (!res.headersSent) res.status(500).send('Error during streaming.');
    });
  } catch (err) {
    console.error('YTDL Initiation Error:', err);
    if (!res.headersSent) res.status(500).send('Failed to initiate audio stream.');
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

// Test database connection on startup
sql`SELECT 1`
  .then(() => console.log('✅ Database connected'))
  .catch(err => {
    console.error('❌ Database connection failed:', err);
    process.exit(1);
  });
