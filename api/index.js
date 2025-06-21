const express = require('express');
const ytdl = require('@distube/ytdl-core');
const fetch = require('node-fetch');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Replace this with your actual frontend domain in production
const ALLOWED_ORIGIN = 'https://profound-marigold-230ee5.netlify.app';

// ✅ CORS Configuration
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.options('*', cors());
app.use(express.json());

const VALID_MD5_HASH = '6bb8c2f529084cdbc037e4b801cc2ab4';

function validateAndGetApiKey(md5Hash) {
  if (md5Hash !== VALID_MD5_HASH) throw new Error('Invalid API key hash');
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YouTube API key not configured');
  return apiKey;
}

// ✅ Health endpoints for connection check
app.get('/', (req, res) => {
  res.json({ message: 'YouTube Audio API is running', status: 'OK', timestamp: new Date().toISOString() });
});
app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));
app.get('/api/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));
app.get('/status', (req, res) => res.json({ status: 'OK' }));
app.get('/api/status', (req, res) => res.json({ status: 'OK' }));

// ✅ YouTube Search API
app.post('/api/search', async (req, res) => {
  try {
    const { query, pageToken, md5Hash } = req.body;
    if (!query) return res.status(400).json({ error: 'Query required' });
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

    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || 'API error', details: data });

    const videos = data.items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
      publishedAt: item.snippet.publishedAt
    }));

    res.json({ videos, nextPageToken: data.nextPageToken, prevPageToken: data.prevPageToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Get audio stream metadata
app.post('/api/audio/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const { md5Hash } = req.body;
    if (!videoId) return res.status(400).json({ error: 'Video ID required' });
    if (md5Hash !== VALID_MD5_HASH) return res.status(403).json({ error: 'Invalid hash' });

    const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

    if (!audioFormats.length) return res.status(404).json({ error: 'No audio formats found' });

    const bestAudio = audioFormats.reduce((best, cur) =>
      (cur.audioBitrate || 0) > (best.audioBitrate || 0) ? cur : best
    );

    res.json({
      audioUrl: bestAudio.url,
      title: info.videoDetails.title,
      duration: info.videoDetails.lengthSeconds,
      mimeType: bestAudio.mimeType,
      bitrate: bestAudio.audioBitrate
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Legacy search/download endpoints
app.get('/search/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const { q, pageToken } = req.query;
    const apiKey = validateAndGetApiKey(hash);

    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('q', q);
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

// ✅ 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ✅ Error middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ CORS allowed from: ${ALLOWED_ORIGIN}`);
  console.log(`✅ YouTube API Key present: ${!!process.env.YOUTUBE_API_KEY}`);
});
