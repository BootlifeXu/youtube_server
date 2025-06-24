import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import ytdl from '@distube/ytdl-core';
import postgres from 'postgres';

// --- Database Connection ---
const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require', 
});

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---

// ⭐ FIX: Replaced simple cors() with a more robust configuration
// This explicitly allows requests from any origin and handles the browser's
// preflight OPTIONS requests, which is the cause of the "Failed to fetch" error.
const corsOptions = {
  origin: '*', // Allow all origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Allow all standard methods
  allowedHeaders: ['Content-Type', 'Authorization'], // Allow common headers
};
app.use(cors(corsOptions));
// Ensure preflight requests are handled for all routes
app.options('*', cors(corsOptions)); 

app.use(express.json());

// --- Core & Health Routes (No changes) ---
app.get('/', (req, res) => res.status(200).json({ message: 'Server is up and running!' }));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));


// --- ⭐ UPDATED DATABASE-DRIVEN FAVORITES API ⭐ ---

// GET /api/favorites - Fetch all favorites
app.get('/api/favorites', async (req, res) => {
  try {
    const favorites = await sql`SELECT * FROM favorites ORDER BY created_at DESC`;
    // Map db `video_id` and `folder_id` to JS-friendly camelCase
    const formattedFavorites = favorites.map(fav => ({
        id: fav.video_id,
        title: fav.title,
        channel: fav.channel,
        thumbnail: fav.thumbnail,
        folderId: fav.folder_id // Send folderId to frontend
    }));
    res.status(200).json(formattedFavorites);
  } catch (error) {
    console.error('DB Error - Fetching favorites:', error);
    res.status(500).json({ error: 'Failed to fetch favorites from database' });
  }
});

// POST /api/favorites - Add a new favorite
app.post('/api/favorites', async (req, res) => {
  try {
    // Now accepts an optional folderId
    const { id, title, channel, thumbnail, folderId } = req.body;
    if (!id || !title || !channel) {
      return res.status(400).json({ error: 'Missing required favorite data' });
    }
    await sql`
      INSERT INTO favorites (video_id, title, channel, thumbnail, folder_id)
      VALUES (${id}, ${title}, ${channel}, ${thumbnail}, ${folderId || null})
      ON CONFLICT (video_id) DO UPDATE SET -- If song exists, update its folder
        folder_id = EXCLUDED.folder_id,
        title = EXCLUDED.title, -- Also update title/channel in case they changed
        channel = EXCLUDED.channel,
        thumbnail = EXCLUDED.thumbnail;
    `;
    res.status(201).json({ message: 'Favorite added or updated' });
  } catch (error) {
    console.error('DB Error - Adding favorite:', error);
    res.status(500).json({ error: 'Failed to add favorite to database' });
  }
});

// DELETE /api/favorites/:videoId - Remove a favorite
app.delete('/api/favorites/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    await sql`DELETE FROM favorites WHERE video_id = ${videoId}`;
    res.status(200).json({ message: 'Favorite removed successfully' });
  } catch (error) {
    console.error('DB Error - Removing favorite:', error);
    res.status(500).json({ error: 'Failed to remove favorite' });
  }
});

// PUT /api/favorites/:videoId/move - Move a favorite to a different folder
app.put('/api/favorites/:videoId/move', async (req, res) => {
  try {
    const { videoId } = req.params;
    const { folderId } = req.body; // folderId can be a string or null
    const result = await sql`
      UPDATE favorites SET folder_id = ${folderId || null} WHERE video_id = ${videoId}
    `;
    if (result.count === 0) {
      return res.status(404).json({ message: 'Favorite not found' });
    }
    res.status(200).json({ message: 'Favorite moved successfully' });
  } catch (error) {
    console.error('DB Error - Moving favorite:', error);
    res.status(500).json({ error: 'Failed to move favorite' });
  }
});


// --- ⭐ UPDATED DATABASE-DRIVEN FOLDERS API ⭐ ---

// GET /api/folders - Fetch all folders
app.get('/api/folders', async (req, res) => {
  try {
    const folders = await sql`SELECT * FROM folders ORDER BY created_at DESC`;
    res.status(200).json(folders);
  } catch (error) {
    console.error('DB Error - Fetching folders:', error);
    res.status(500).json({ error: 'Failed to fetch folders' });
  }
});

// POST /api/folders - Create a new folder
app.post('/api/folders', async (req, res) => {
  try {
    const { id, name, createdAt } = req.body;
    if (!id || !name || !createdAt) {
      return res.status(400).json({ error: 'Missing required folder data' });
    }
    const newFolder = await sql`
      INSERT INTO folders (id, name, created_at) VALUES (${id}, ${name}, ${createdAt})
      RETURNING *
    `;
    res.status(201).json(newFolder[0]);
  } catch (error) {
    console.error('DB Error - Creating folder:', error);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// PUT /api/folders/:folderId - Rename a folder
app.put('/api/folders/:folderId', async (req, res) => {
  try {
    const { folderId } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'New name is required' });

    await sql`UPDATE folders SET name = ${name} WHERE id = ${folderId}`;
    res.status(200).json({ message: 'Folder renamed' });
  } catch (error) {
    console.error('DB Error - Renaming folder:', error);
    res.status(500).json({ error: 'Failed to rename folder' });
  }
});

// DELETE /api/folders/:folderId - Delete a folder and move its contents
app.delete('/api/folders/:folderId', async (req, res) => {
  const { folderId } = req.params;
  try {
    // Use a transaction to ensure both operations succeed or fail together
    await sql.begin(async sql => {
      // 1. Move all favorites from this folder to the root (folder_id = null)
      await sql`UPDATE favorites SET folder_id = NULL WHERE folder_id = ${folderId}`;
      // 2. Delete the folder itself
      await sql`DELETE FROM folders WHERE id = ${folderId}`;
    });
    res.status(200).json({ message: 'Folder deleted and contents moved to root' });
  } catch (error) {
    console.error('DB Error - Deleting folder:', error);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});


// --- Streaming and Search Routes (No changes) ---
app.get('/api/stream/:videoId', async (req, res) => {
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

app.post('/api/search', async (req, res) => {
  const { query, pageToken, md5Hash } = req.body;
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
    if (pageToken) apiUrl += `&pageToken=${pageToken}`;
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
    res.json({ videos, nextPageToken: json.nextPageToken || null, prevPageToken: json.prevPageToken || null });
  } catch (error) {
    console.error('Search API error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});


// Start the server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
