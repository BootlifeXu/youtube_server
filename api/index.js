const express = require('express');
const serverless = require('serverless-http');
const ytdl = require('@distube/ytdl-core');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();

// Enable CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const VALID_MD5_HASH = '6bb8c2f529084cdbc037e4b801cc2ab4';

function validateAndGetApiKey(md5Hash) {
  if (md5Hash !== VALID_MD5_HASH) throw new Error('Invalid API key hash');
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YouTube API key not configured');
  return apiKey;
}

app.get('/', (req, res) => {
  res.json({ message: 'API is running' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.get('/search/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const { q: query, pageToken } = req.query;
    const apiKey = validateAndGetApiKey(hash);

    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', 10);
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

module.exports = app;
module.exports.handler = serverless(app);
