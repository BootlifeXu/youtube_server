// api/index.js
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import ytdl from '@distube/ytdl-core';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // ✅ Allow all origins
app.use(express.json());

// ✅ Health check route
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/status', (req, res) => {
  res.json({ status: 'server running' });
});

app.get('/status', (req, res) => {
  res.json({ status: 'online' });
});

// ✅ Get audio URL for a YouTube video
app.post('/api/audio/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const { md5Hash } = req.body;

  if (md5Hash !== '6bb8c2f529084cdbc037e4b801cc2ab4') {
    return res.status(403).json({ error: 'Invalid API key hash' });
  }

  try {
    const info = await ytdl.getInfo(videoId);
    const audioFormat = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });

    if (!audioFormat || !audioFormat.url) {
      return res.status(404).json({ error: 'Audio stream not found' });
    }

    res.json({ audioUrl: audioFormat.url });
  } catch (err) {
    console.error('Audio fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve audio URL' });
  }
});

// ✅ YouTube Search Route (Replace with real API logic if needed)
app.post('/api/search', async (req, res) => {
  const { query, md5Hash } = req.body;

  if (md5Hash !== '6bb8c2f529084cdbc037e4b801cc2ab4') {
    return res.status(403).json({ error: 'Invalid API key hash' });
  }

  try {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?key=AIzaSyD2o0roVVcvfCEseTsqyFI6J2gs68hNcdo&type=video&part=snippet&videoCategoryId=10&maxResults=10&q=${encodeURIComponent(query)}`);
    const json = await response.json();

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

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
