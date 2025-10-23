const express = require('express');
const fs = require('fs');
const path = require('path'); 
const mime = require('mime-types');
const multer = require('multer');
const NodeID3 = require('node-id3');
const { Op } = require('sequelize');
const { Song, Playlist, DownloadStatus } = require('./database');
const { downloadSong } = require('./downloader');

const router = express.Router();
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf-8'));

// --- MP3 Upload Setup ---
const TEMP_UPLOAD_DIR = path.join(__dirname, '..', 'data', 'temp_uploads');
const upload = multer({
    dest: TEMP_UPLOAD_DIR, 
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'audio/mpeg' || file.mimetype === 'audio/mp3') {
            cb(null, true);
        } else {
            cb(new Error('Alleen .mp3 bestanden zijn toegestaan'), false);
        }
    }
});
fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

// --- Song Endpoints ---

// AANGEPAST: MP3 Upload (nu 'array' i.p.v. 'single')
router.post('/upload', upload.array('mp3files', 50), async (req, res) => { // Max 50
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ detail: "Geen bestanden geüpload." });
    }

    const createdSongs = [];

    // Loop door alle geüploade bestanden
    for (const file of req.files) {
        const tempPath = file.path;
        try {
            const tags = NodeID3.read(tempPath);
            const newSong = await Song.create({
                title: tags.title || file.originalname.replace('.mp3', ''),
                artist: tags.artist || 'Unknown Artist',
                album: tags.album || 'Unknown Album',
                status: DownloadStatus.COMPLETE,
            });

            const finalPath = path.join(__dirname, '..', config.music_directory, `${newSong.id}.mp3`);
            fs.renameSync(tempPath, finalPath);
            
            newSong.file_path = path.join(config.music_directory, `${newSong.id}.mp3`);
            await newSong.save();
            createdSongs.push(newSong); // Voeg toe aan de lijst van succesvolle uploads

        } catch (e) {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            console.error(`Uploadfout voor ${file.originalname}:`, e);
            // Sla dit bestand over en ga door met de rest
        }
    }

    // Stuur een array van alle aangemaakte nummers terug
    res.status(201).json(createdSongs);
});


// Voeg toe via URL
router.post('/add', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ detail: "URL is vereist" });

    try {
        let song = await Song.findOne({ where: { original_url: url } });
        if (!song) {
            song = await Song.create({
                original_url: url,
                status: DownloadStatus.PENDING,
                title: "In wachtrij...",
                artist: url
            });
        } else {
            song.status = DownloadStatus.PENDING;
            await song.save();
        }
        downloadSong(url);
        res.status(202).json(song);
    } catch (e) {
        res.status(500).json({ detail: e.message });
    }
});

// Haal alle nummers op
router.get('/songs', async (req, res) => {
    const songs = await Song.findAll({
        order: [['artist', 'ASC'], ['title', 'ASC']]
    });
    res.json(songs);
});

// Haal download-statussen op
router.get('/songs/status', async (req, res) => {
    const songs = await Song.findAll({
        where: {
            status: { [Op.in]: [DownloadStatus.PENDING, DownloadStatus.DOWNLOADING] }
        }
    });
    res.json(songs);
});

// Stream een nummer
router.get('/stream/:songId', async (req, res) => {
    const song = await Song.findByPk(req.params.songId);
    if (!song || !song.file_path || song.status !== DownloadStatus.COMPLETE) {
        return res.status(404).json({ detail: "Nummer niet gevonden of niet gereed" });
    }
    const absoluteFilePath = path.join(__dirname, '..', song.file_path);
    if (!fs.existsSync(absoluteFilePath)) {
        song.status = DownloadStatus.ERROR;
        song.error_message = "Bestand niet gevonden op schijf.";
        await song.save();
        return res.status(404).json({ detail: "Audiobestand mist" });
    }
    const stat = fs.statSync(absoluteFilePath);
    const fileSize = stat.size;
    const mimeType = mime.lookup(absoluteFilePath) || 'audio/mpeg';
    res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes'
    });
    const readStream = fs.createReadStream(absoluteFilePath);
    readStream.pipe(res);
});

// Verwijder een nummer (permanent)
router.delete('/songs/:songId', async (req, res) => {
    const song = await Song.findByPk(req.params.songId);
    if (!song) {
        return res.status(404).json({ detail: "Nummer niet gevonden" });
    }
    try {
        if (song.file_path) {
            const absoluteFilePath = path.join(__dirname, '..', song.file_path);
            if (fs.existsSync(absoluteFilePath)) {
                fs.unlinkSync(absoluteFilePath);
            }
        }
        await song.destroy();
        res.status(204).send();
    } catch (e) {
        console.error("Fout bij verwijderen nummer:", e);
        res.status(500).json({ detail: "Kon bestand of database entry niet verwijderen." });
    }
});


// --- Playlist Endpoints ---

// Maak playlist
router.post('/playlists', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ detail: "Naam is vereist" });
    try {
        const newPlaylist = await Playlist.create({ name });
        const responsePlaylist = newPlaylist.toJSON();
        responsePlaylist.song_count = 0;
        res.status(201).json(responsePlaylist);
    } catch (e) {
        res.status(400).json({ detail: "Playlist naam bestaat al" });
    }
});

// Haal alle playlists op
router.get('/playlists', async (req, res) => {
    const playlists = await Playlist.findAll({
        include: { model: Song, attributes: ['id'] }
    });
    const result = playlists.map(p => ({
        id: p.id,
        name: p.name,
        song_count: p.songs ? p.songs.length : 0
    }));
    res.json(result);
});

// Haal playlist details op
router.get('/playlists/:playlistId', async (req, res) => {
    const playlist = await Playlist.findByPk(req.params.playlistId, {
        include: { model: Song }, 
        order: [ [Song, 'artist', 'ASC'], [Song, 'title', 'ASC'] ]
    });
    if (!playlist) return res.status(404).json({ detail: "Playlist niet gevonden" });
    res.json(playlist);
});

// Voeg nummer toe aan playlist
router.post('/playlists/:playlistId/add/:songId', async (req, res) => {
    const playlist = await Playlist.findByPk(req.params.playlistId);
    const song = await Song.findByPk(req.params.songId);
    if (!playlist || !song) return res.status(404).json({ detail: "Playlist of nummer niet gevonden" });
    if (song.status !== DownloadStatus.COMPLETE) return res.status(400).json({ detail: "Nummer is nog niet gedownload" });
    
    await playlist.addSong(song);
    const updatedPlaylist = await Playlist.findByPk(req.params.playlistId, { include: Song });
    res.json(updatedPlaylist);
});

// Verwijder nummer uit playlist
router.delete('/playlists/:playlistId/remove/:songId', async (req, res) => {
    const playlist = await Playlist.findByPk(req.params.playlistId);
    const song = await Song.findByPk(req.params.songId);
    if (!playlist || !song) return res.status(404).json({ detail: "Playlist of nummer niet gevonden" });
    
    await playlist.removeSong(song);
    const updatedPlaylist = await Playlist.findByPk(req.params.playlistId, { include: Song });
    res.json(updatedPlaylist);
});

// Verwijder playlist
router.delete('/playlists/:playlistId', async (req, res) => {
    const playlist = await Playlist.findByPk(req.params.playlistId);
    if (!playlist) return res.status(404).json({ detail: "Playlist niet gevonden" });
    
    await playlist.destroy();
    res.status(204).send();
});


module.exports = router;