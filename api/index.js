// api/index.js

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch'; // Still needed for the search API
import ytdl from '@distube/ytdl-core';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// --- Core Routes ---

// Root route for health checks by the hosting platform
app.get('/', (req, res) => {
  res.status(200).json({ message: 'Server is up and running!' });
});

// Health check route for your frontend to use
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});


// --- NEW STREAMING ENDPOINT ---
// This endpoint fetches the audio from YouTube and streams it directly to the client.
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;

  if (!ytdl.validateID(videoId)) {
    return res.status(400).send('Invalid YouTube Video ID');
  }

  try {
    // Set headers to inform the browser that it's receiving an audio stream
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');

    // Get the audio stream from ytdl
    const audioStream = ytdl(videoId, {
      filter: 'audioonly',
      quality: 'highestaudio',
    });

    // Pipe the audio stream directly to the HTTP response.
    // This sends the data chunk by chunk as it's downloaded from YouTube.
    audioStream.pipe(res);

    // Add error handling for the stream itself
    audioStream.on('error', (err) => {
      console.error('Stream Error:', err);
      // If headers aren't sent yet, we can send an error status.
      // Otherwise, the connection just closes.
      if (!res.headersSent) {
        res.status(500).send('Error during audio streaming.');
      }
    });

  } catch (err) {
    console.error('YTDL Initiation Error:', err);
    if (!res.headersSent) {
        res.status(500).send('Failed to initiate audio stream.');
    }
  }
});


// --- YouTube Search Route (No changes needed here) ---
app.post('/api/search', async (req, res) => {
  const { query, pageToken, md5Hash } = req.body; // Added pageToken
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
    if (pageToken) {
        apiUrl += `&pageToken=${pageToken}`;
    }

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
