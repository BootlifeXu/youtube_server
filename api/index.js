# Saving the updated backend file to provide a complete version to the user

updated_backend_code = """
// ✅ Updated api/index.js (with improved YTDL error handling)

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

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.status(200).json({ message: 'Server is up and running!' }));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.get('/api/favorites', async (req, res) => {
  try {
    const favorites = await sql\`SELECT * FROM favorites ORDER BY created_at DESC\`;
    const formattedFavorites = favorites.map(fav => ({
      id: fav.video_id,
      title: fav.title,
      channel: fav.channel,
      thumbnail: fav.thumbnail
    }));
    res.status(200).json(formattedFavorites);
  } catch (error) {
    console.error('DB Error - Fetching favorites:', error);
    res.status(500).json({ error: 'Failed to fetch favorites from database' });
  }
});

app.post('/api/favorites', async (req, res) => {
  try {
    const { id, title, channel, thumbnail } = req.body;
    if (!id || !title || !channel) {
      return res.status(400).json({ error: 'Missing required favorite data (id, title, channel)' });
    }
    await sql\`
      INSERT INTO favorites (video_id, title, channel, thumbnail)
      VALUES (\${id}, \${title}, \${channel}, \${thumbnail})
      ON CONFLICT (video_id) DO NOTHING
    \`;
    res.status(201).json({ message: 'Favorite added successfully' });
  } catch (error) {
    console.error('DB Error - Adding favorite:', error);
    res.status(500).json({ error: 'Failed to add favorite to database' });
  }
});

app.delete('/api/favorites/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const result = await sql\`
      DELETE FROM favorites WHERE video_id = \${videoId}
    \`;
    if (result.count === 0) {
      return res.status(404).json({ message: 'Favorite not found in database' });
    }
    res.status(200).json({ message: 'Favorite removed successfully' });
  } catch (error) {
    console.error('DB Error - Removing favorite:', error);
    res.status(500).json({ error: 'Failed to remove favorite from database' });
  }
});

// ✅ Improved streaming endpoint with specific YTDL error handling
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  console.log('Streaming request for video:', videoId);

  if (!ytdl.validateID(videoId)) {
    return res.status(400).send('Invalid YouTube Video ID');
  }

  try {
    res.setHeader('Content-Type', 'audio/mpeg');
    const stream = ytdl(videoId, { filter: 'audioonly', quality: 'highestaudio' });
    stream.pipe(res);
    stream.on('error', err => {
      console.error('YTDL Error:', err);
      if (!res.headersSent) {
        if (err.message.includes('Sign in to confirm')) {
          res.status(403).send('Audio cannot be streamed due to YouTube restrictions.');
        } else {
          res.status(500).send('Audio streaming failed.');
        }
      }
    });
  } catch (err) {
    console.error('YTDL Initiation Error:', err);
    if (!res.headersSent) res.status(500).send('Audio stream could not be started.');
  }
});

app.post('/api/search', async (req, res) => {
  const { query, pageToken, md5Hash } = req.body;
  if (md5Hash !== '6bb8c2f529084cdbc037e4b801cc2ab4') {
    return res.status(403).json({ error: 'Invalid API key hash' });
  }
  try {
    const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
    if (!YOUTUBE_API_KEY) {
      return res.status(500).json({ error: 'Server configuration error: Missing YouTube API key' });
    }
    let apiUrl = \`https://www.googleapis.com/youtube/v3/search?key=\${YOUTUBE_API_KEY}&type=video&part=snippet&videoCategoryId=10&maxResults=10&q=\${encodeURIComponent(query)}\`;
    if (pageToken) apiUrl += \`&pageToken=\${pageToken}\`;
    const response = await fetch(apiUrl);
    const json = await response.json();
    if (json.error) {
      return res.status(500).json({ error: 'Failed to fetch from YouTube API' });
    }
    const videos = json.items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.default.url
    }));
    res.json({ videos, nextPageToken: json.nextPageToken || null, prevPageToken: json.prevPageToken || null });
  } catch (error) {
    console.error('Search API error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port \${PORT}`);
});
"""

# Save to file so the user can download it
path = "/mnt/data/index_updated.js"
with open(path, "w") as f:
    f.write(updated_backend_code)

path
