// server/api/index.js
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import ytdl from '@distube/ytdl-core';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => res.json({ message: 'Server is running' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Folders API
app.get('/api/folders', async (req, res) => {
  try {
    const folders = await sql`SELECT * FROM folders ORDER BY name`;
    res.json(folders);
  } catch (err) {
    console.error('Error fetching folders:', err);
    res.status(500).json({ error: 'Failed to fetch folders' });
  }
});

app.post('/api/folders', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Folder name is required' });
    const [folder] = await sql`
      INSERT INTO folders (name) VALUES (${name}) RETURNING *
    `;
    res.status(201).json(folder);
  } catch (err) {
    console.error('Error creating folder:', err);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

app.put('/api/folders/:id', async (req, res) => {
  try {
    const { name } = req.body;
    const { id } = req.params;
    if (!name) return res.status(400).json({ error: 'Folder name is required' });
    const [folder] = await sql`
      UPDATE folders SET name = ${name} WHERE id = ${id} RETURNING *
    `;
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    res.json(folder);
  } catch (err) {
    console.error('Error updating folder:', err);
    res.status(500).json({ error: 'Failed to update folder' });
  }
});

app.delete('/api/folders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await sql`UPDATE favorites SET folder_id = NULL WHERE folder_id = ${id}`;
    const result = await sql`DELETE FROM folders WHERE id = ${id}`;
    if (result.count === 0) return res.status(404).json({ error: 'Folder not found' });
    res.json({ message: 'Folder deleted successfully' });
  } catch (err) {
    console.error('Error deleting folder:', err);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// Favorites API
app.get('/api/favorites', async (req, res) => {
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
    res.json(favorites);
  } catch (err) {
    console.error('Error fetching favorites:', err);
    res.status(500).json({ error: 'Failed to fetch favorites' });
  }
});

app.post('/api/favorites', async (req, res) => {
  try {
    const { id, title, channel, thumbnail, folderId } = req.body;
    if (!id || !title || !channel) return res.status(400).json({ error: 'Missing required fields' });
    await sql`
      INSERT INTO favorites (video_id, title, channel, thumbnail, folder_id)
      VALUES (${id}, ${title}, ${channel}, ${thumbnail}, ${folderId || null})
      ON CONFLICT (video_id) DO UPDATE SET folder_id = EXCLUDED.folder_id
    `;
    res.status(201).json({ message: 'Favorite added successfully' });
  } catch (err) {
    console.error('Error adding favorite:', err);
    res.status(500).json({ error: 'Failed to add favorite' });
  }
});

app.delete('/api/favorites/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const result = await sql`DELETE FROM favorites WHERE video_id = ${videoId}`;
    if (result.count === 0) return res.status(404).json({ error: 'Favorite not found' });
    res.json({ message: 'Favorite removed successfully' });
  } catch (err) {
    console.error('Error deleting favorite:', err);
    res.status(500).json({ error: 'Failed to delete favorite' });
  }
});

// Stream audio from YouTube
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!ytdl.validateID(videoId)) return res.status(400).send('Invalid video ID');
  try {
    res.setHeader('Content-Type', 'audio/mpeg');
    const stream = ytdl(videoId, { filter: 'audioonly', quality: 'highestaudio' });
    stream.pipe(res);
    stream.on('error', err => {
      console.error('Stream error:', err);
      if (!res.headersSent) res.status(500).send('Streaming error');
    });
  } catch (err) {
    console.error('YTDL error:', err);
    if (!res.headersSent) res.status(500).send('Stream failed');
  }
});

// Search videos using YouTube Data API
app.post('/api/search', async (req, res) => {
  const { query, pageToken, md5Hash } = req.body;
  if (md5Hash !== '6bb8c2f529084cdbc037e4b801cc2ab4') return res.status(403).json({ error: 'Invalid key' });

  try {
    const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
    if (!YOUTUBE_API_KEY) return res.status(500).json({ error: 'Missing API key' });
    let url = `https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_API_KEY}&type=video&part=snippet&videoCategoryId=10&maxResults=10&q=${encodeURIComponent(query)}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const response = await fetch(url);
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: 'YouTube API failed' });

    const videos = data.items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.default.url
    }));

    res.json({ videos, nextPageToken: data.nextPageToken || null, prevPageToken: data.prevPageToken || null });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
