// api/index.js

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

// Middleware
app.use(cors());
app.use(express.json());

// Create a new router instance for our API. This is the standard practice.
const api = express.Router();

// --- Core & Health Routes on the API Router ---
// These routes will be accessed via /api/health, etc.
api.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// --- Folder CRUD Operations on the API Router ---
api.get('/folders', async (req, res) => {
  try {
    const folders = await sql`SELECT * FROM folders ORDER BY name`;
    res.status(200).json(folders);
  } catch (error) {
    console.error('DB Error - Fetching folders:', error);
    res.status(500).json({ error: 'Failed to fetch folders from database' });
  }
});

api.post('/folders', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Folder name is required' });
    }
    const [folder] = await sql`
      INSERT INTO folders (name) 
      VALUES (${name}) 
      RETURNING *
    `;
    res.status(201).json(folder);
  } catch (error) {
    console.error('DB Error - Creating folder:', error);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

api.put('/folders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Folder name is required' });
    }
    const [folder] = await sql`
      UPDATE folders 
      SET name = ${name} 
      WHERE id = ${id} 
      RETURNING *
    `;
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    res.status(200).json(folder);
  } catch (error) {
    console.error('DB Error - Updating folder:', error);
    res.status(500).json({ error: 'Failed to update folder' });
  }
});

api.delete('/folders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await sql`UPDATE favorites SET folder_id = NULL WHERE folder_id = ${id}`;
    const result = await sql`DELETE FROM folders WHERE id = ${id}`;
    if (result.count === 0) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    res.status(200).json({ message: 'Folder deleted successfully' });
  } catch (error) {
    console.error('DB Error - Deleting folder:', error);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// --- Favorites API Routes on the API Router ---
api.get('/favorites', async (req, res) => {
  try {
    const favorites = await sql`
      SELECT 
        f.id as favorite_id,
        f.video_id as id,
        f.title,
        f.channel,
        f.thumbnail,
        f.folder_id,
        fo.name as folder_name
      FROM favorites f
      LEFT JOIN folders fo ON f.folder_id = fo.id
      ORDER BY COALESCE(fo.name, ''), f.title
    `;
    res.status(200).json(favorites);
  } catch (error) {
    console.error('DB Error - Fetching favorites:', error);
    res.status(500).json({ error: 'Failed to fetch favorites from database' });
  }
});

api.post('/favorites', async (req, res) => {
  try {
    const { id, title, channel, thumbnail, folderId } = req.body;
    if (!id || !title || !channel) {
      return res.status(400).json({ error: 'Missing required favorite data' });
    }
    await sql`
      INSERT INTO favorites (video_id, title, channel, thumbnail, folder_id)
      VALUES (${id}, ${title}, ${channel}, ${thumbnail}, ${folderId || null})
      ON CONFLICT (video_id) DO UPDATE 
      SET folder_id = EXCLUDED.folder_id
    `;
    res.status(201).json({ message: 'Favorite added successfully' });
  } catch (error) {
    console.error('DB Error - Adding favorite:', error);
    res.status(500).json({ error: 'Failed to add favorite to database' });
  }
});

api.delete('/favorites/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const result = await sql`DELETE FROM favorites WHERE video_id = ${videoId}`;
    if (result.count === 0) {
      return res.status(404).json({ message: 'Favorite not found' });
    }
    res.status(200).json({ message: 'Favorite removed successfully' });
  } catch (error) {
    console.error('DB Error - Removing favorite:', error);
    res.status(500).json({ error: 'Failed to remove favorite from database' });
  }
});

// --- Streaming and Search Routes on the API Router ---
api.get('/stream/:videoId', async (req, res) => {
    // ... (rest of your stream logic)
    const { videoId } = req.params;
    if (!ytdl.validateID(videoId)) {
      return res.status(400).send('Invalid YouTube Video ID');
    }
    try {
      res.setHeader('Content-Type', 'audio/mpeg');
      const audioStream = ytdl(videoId, { filter: 'audioonly', quality: 'highestaudio' });
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

api.post('/search', async (req, res) => {
    // ... (rest of your search logic)
    const { query, pageToken, md5Hash } = req.body;
    if (md5Hash !== '6bb8c2f529084cdbc037e4b801cc2ab4') {
      return res.status(403).json({ error: 'Invalid API key hash' });
    }
    try {
      const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY; 
      if (!YOUTUBE_API_KEY) {
        return res.status(500).json({ error: 'Server configuration error' });
      }
      let apiUrl = `https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_API_KEY}&type=video&part=snippet&videoCategoryId=10&maxResults=10&q=${encodeURIComponent(query)}`;
      if (pageToken) apiUrl += `&pageToken=${pageToken}`;
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

// Tell the main 'app' to use our 'api' router for any path that starts with '/api'
app.use('/api', api);

// A root route on the main app for basic checks
app.get('/', (req, res) => res.status(200).json({ message: 'Server is up and running!' }));

// Start the server
const server = app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
