const express = require('express');
const ytdl = require('@distube/ytdl-core');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Allow only your Netlify frontend to access the server
app.use(cors({
  origin: 'https://profound-marigold-230ee5.netlify.app',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: false
}));

// Handle preflight
app.options('*', cors());
app.use(express.json());

// 🔐 Hardcoded hash validation
const VALID_MD5_HASH = '6bb8c2f529084cdbc037e4b801cc2ab4';

function validateAndGetApiKey(md5Hash) {
  if (md5Hash !== VALID_MD5_HASH) throw new Error('Invalid API key hash');
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YouTube API key not configured');
  return apiKey;
}

// ✅ Health check
app.get('/', (req, res) => {
  res.json({ message: 'YouTube Audio API is running', status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 🔍 Search
app.post('/api/search', async (req, res) => {
  try {
    const { query, pageToken, md5Hash } = req.body;
    if (!query) return res.status(400).json({ error: 'Query parameter is required' });

    const apiKey = validateAndGetApiKey(md5Hash);
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', '10');
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: data.error?.message || 'YouTube API error',
        details: data
      });
    }

    const videos = data.items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
      publishedAt: item.snippet.publishedAt
    }));

    res.json({ 
      videos, 
      nextPageToken: data.nextPageToken,
      prevPageToken: data.prevPageToken 
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 🔊 Audio stream
app.post('/api/audio/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const { md5Hash } = req.body;

    if (!videoId) return res.status(400).json({ error: 'Video ID is required' });
    if (md5Hash !== VALID_MD5_HASH) return res.status(403).json({ error: 'Invalid hash' });

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const info = await ytdl.getInfo(videoUrl);
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

    if (!audioFormats.length) return res.status(404).json({ error: 'No audio formats found' });

    const bestAudio = audioFormats.reduce((best, current) => {
      const bestBitrate = parseInt(best.audioBitrate) || 0;
      const currentBitrate = parseInt(current.audioBitrate) || 0;
      return currentBitrate > bestBitrate ? current : best;
    });

    res.json({
      audioUrl: bestAudio.url,
      title: info.videoDetails.title,
      duration: info.videoDetails.lengthSeconds,
      mimeType: bestAudio.mimeType,
      bitrate: bestAudio.audioBitrate
    });
  } catch (err) {
    console.error('Audio fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 🔁 Legacy search
app.get('/search/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const { q: query, pageToken } = req.query;
    const apiKey = validateAndGetApiKey(hash);

    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', '10');
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) return res.status(response.status).json(data);

    const videos = data.items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium?.url,
      publishedAt: item.snippet.publishedAt
    }));

    res.json({ videos, nextPageToken: data.nextPageToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🎧 Legacy audio download
app.get('/download/:hash/:videoId', async (req, res) => {
  try {
    const { hash, videoId } = req.params;
    if (hash !== VALID_MD5_HASH) return res.status(403).json({ error: 'Invalid hash' });

    const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
    const audio = ytdl.filterFormats(info.formats, 'audioonly')[0];

    res.json({
      audio: audio.url,
      title: info.videoDetails.title,
      duration: info.videoDetails.lengthSeconds
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🧯 Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// 🚀 Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`YouTube API Key configured: ${!!process.env.YOUTUBE_API_KEY}`);
});

module.exports = app;
