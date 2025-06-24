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

// ⭐ THE FIX: This line solves the CORS error.
// It must be placed before your API routes.
app.use(cors()); 

app.use(express.json());

// --- Core & Health Routes ---
app.get('/', (req, res) => res.status(200).json({ message: 'Server is up and running!' }));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));

// --- Favorites API Routes ---
app.get('/api/favorites', async (req, res) => {
  try {
    const favorites = await sql`SELECT * FROM favorites ORDER BY created_at DESC`;
    const formattedFavorites = favorites.map(fav => ({
        id: fav.video_id,
        title: fav.title,
        channel: fav.channel,
        thumbnail: fav.thumbnail,
        folderId: fav.folder_id
    }));
    res.status(200).json(formattedFavorites);
  } catch (error) {
    console.error('DB Error - Fetching favorites:', error);
    res.status(500).json({ error: 'Failed to fetch favorites from database' });
  }
});

// ... (The rest of your API routes: POST /favorites, DELETE /favorites, etc., remain the same) ...

// POST /api/favorites
app.post('/api/favorites', async (req, res) => {
  try {
    const { id, title, channel, thumbnail, folderId } = req.body;
    if (!id || !title || !channel) {
      return res.status(400).json({ error: 'Missing required favorite data' });
    }
    await sql`
      INSERT INTO favorites (video_id, title, channel, thumbnail, folder_id)
      VALUES (${id}, ${title}, ${channel}, ${thumbnail}, ${folderId || null})
      ON CONFLICT (video_id) DO UPDATE SET
        folder_id = EXCLUDED.folder_id,
        title = EXCLUDED.title,
        channel = EXCLUDED.channel,
        thumbnail = EXCLUDED.thumbnail;
    `;
    res.status(201).json({ message: 'Favorite added or updated' });
  } catch (error) {
    console.error('DB Error - Adding favorite:', error);
    res.status(500).json({ error: 'Failed to add favorite to database' });
  }
});

// DELETE /api/favorites/:videoId
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

// PUT /api/favorites/:videoId/move
app.put('/api/favorites/:videoId/move', async (req, res) => {
  try {
    const { videoId } = req.params;
    const { folderId } = req.body;
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

// --- Folders API Routes ---
// GET /api/folders
app.get('/api/folders', async (req, res) => {
  try {
    const folders = await sql`SELECT * FROM folders ORDER BY created_at DESC`;
    res.status(200).json(folders);
  } catch (error) {
    console.error('DB Error - Fetching folders:', error);
    res.status(500).json({ error: 'Failed to fetch folders' });
  }
});

// POST /api/folders
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

// PUT /api/folders/:folderId
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

// DELETE /api/folders/:folderId
app.delete('/api/folders/:folderId', async (req, res) => {
  const { folderId } = req.params;
  try {
    await sql.begin(async sql => {
      await sql`UPDATE favorites SET folder_id = NULL WHERE folder_id = ${folderId}`;
      await sql`DELETE FROM folders WHERE id = ${folderId}`;
    });
    res.status(200).json({ message: 'Folder deleted and contents moved to root' });
  } catch (error) {
    console.error('DB Error - Deleting folder:', error);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// --- Streaming and Search Routes ---
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

// --- Start server only after a successful database connection ---
async function startServer() {
  try {
    await sql`SELECT 1`;
    console.log('✅ Database connection successful.');

    app.listen(PORT, () => {
      console.log(`✅ Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('🔴 FATAL: Could not connect to the database. Please check your DATABASE_URL environment variable.');
    console.error(error);
    process.exit(1);
  }
}

startServer();
