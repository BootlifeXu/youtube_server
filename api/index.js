// api/index.js

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import ytdl from '@distube/ytdl-core';
import postgres from 'postgres';

// --- Database Connection (Unchanged) ---
const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// --- Core & Health Routes (Unchanged) ---
app.get('/', (req, res) => res.status(200).json({ message: 'Server is up and running!' }));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));

// --- ⭐ NEW PLAYLIST MANAGEMENT API ⭐ ---

// GET /api/playlists - Fetch all playlists
app.get('/api/playlists', async (req, res) => {
  try {
    const playlists = await sql`SELECT * FROM playlists ORDER BY created_at ASC`;
    res.status(200).json(playlists);
  } catch (error) {
    console.error('DB Error - Fetching playlists:', error);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// POST /api/playlists - Create a new playlist
app.post('/api/playlists', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Playlist name is required' });
    }
    const [newPlaylist] = await sql`
      INSERT INTO playlists (name) VALUES (${name}) RETURNING *
    `;
    res.status(201).json(newPlaylist);
  } catch (error) {
    console.error('DB Error - Creating playlist:', error);
    res.status(500).json({ error: 'Failed to create playlist' });
  }
});

// PUT /api/playlists/:id - Rename a playlist
app.put('/api/playlists/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'New playlist name is required' });
        }
        const result = await sql`
            UPDATE playlists SET name = ${name} WHERE id = ${id}
        `;
        if (result.count === 0) {
            return res.status(404).json({ message: 'Playlist not found' });
        }
        res.status(200).json({ message: 'Playlist renamed successfully' });
    } catch (error) {
        console.error('DB Error - Renaming playlist:', error);
        res.status(500).json({ error: 'Failed to rename playlist' });
    }
});

// DELETE /api/playlists/:id - Delete a playlist
app.delete('/api/playlists/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await sql`
            DELETE FROM playlists WHERE id = ${id}
        `;
        if (result.count === 0) {
            return res.status(404).json({ message: 'Playlist not found' });
        }
        // Songs within this playlist will have their playlist_id set to NULL
        // due to the "ON DELETE SET NULL" constraint in the schema.
        res.status(200).json({ message: 'Playlist deleted successfully' });
    } catch (error) {
        console.error('DB Error - Deleting playlist:', error);
        res.status(500).json({ error: 'Failed to delete playlist' });
    }
});


// --- ⭐ UPDATED FAVORITES API ⭐ ---

// GET /api/favorites - Now returns playlist_id with each favorite
app.get('/api/favorites', async (req, res) => {
  try {
    // The query now also selects playlist_id
    const favorites = await sql`SELECT video_id, title, channel, thumbnail, playlist_id FROM favorites ORDER BY created_at DESC`;
    const formattedFavorites = favorites.map(fav => ({
        id: fav.video_id,
        title: fav.title,
        channel: fav.channel,
        thumbnail: fav.thumbnail,
        playlistId: fav.playlist_id // Pass the playlist_id to the frontend
    }));
    res.status(200).json(formattedFavorites);
  } catch (error) {
    console.error('DB Error - Fetching favorites:', error);
    res.status(500).json({ error: 'Failed to fetch favorites from database' });
  }
});

// POST /api/favorites - Now accepts a playlistId
app.post('/api/favorites', async (req, res) => {
  try {
    // We now expect a playlistId in the request body
    const { id, title, channel, thumbnail, playlistId } = req.body;
    if (!id || !title || !channel || !playlistId) {
      return res.status(400).json({ error: 'Missing required data (id, title, channel, playlistId)' });
    }
    await sql`
      INSERT INTO favorites (video_id, title, channel, thumbnail, playlist_id)
      VALUES (${id}, ${title}, ${channel}, ${thumbnail}, ${playlistId})
      ON CONFLICT (video_id) DO NOTHING
    `;
    res.status(201).json({ message: 'Favorite added successfully' });
  } catch (error) {
    console.error('DB Error - Adding favorite:', error);
    res.status(500).json({ error: 'Failed to add favorite to database' });
  }
});

// DELETE /api/favorites/:videoId (Unchanged, still works perfectly)
app.delete('/api/favorites/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const result = await sql`DELETE FROM favorites WHERE video_id = ${videoId}`;
    if (result.count === 0) {
        return res.status(404).json({ message: 'Favorite not found in database' });
    }
    res.status(200).json({ message: 'Favorite removed successfully' });
  } catch (error) {
    console.error('DB Error - Removing favorite:', error);
    res.status(500).json({ error: 'Failed to remove favorite from database' });
  }
});

// ⭐ NEW - PUT /api/favorites/:videoId/move - Move a favorite to a different playlist
app.put('/api/favorites/:videoId/move', async (req, res) => {
    try {
        const { videoId } = req.params;
        const { newPlaylistId } = req.body;
        if (newPlaylistId === undefined) {
            return res.status(400).json({ error: 'newPlaylistId is required' });
        }
        const result = await sql`
            UPDATE favorites SET playlist_id = ${newPlaylistId} WHERE video_id = ${videoId}
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


// --- Streaming and Search Routes (Unchanged) ---
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
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
