const fs = require('fs');
const path = require('path');
const YtDlpWrap = require('yt-dlp-wrap');
const { Mutex } = require('async-mutex');
// FIX: Importeer models/DB correct
const { Song, DownloadStatus } = require('./database'); 

// Lees config
const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
// FIX: Maak paden absoluut
const MUSIC_DIR = path.join(__dirname, '..', config.music_directory); 
const CODEC = config.preferred_codec;
const QUALITY = config.preferred_quality;

// FIX: Gebruik .default() op de class constructor
const ytDlpWrap = new YtDlpWrap.default(); 

// Zeer belangrijk: Een Mutex (slot) om te zorgen dat maar ÉÉN download tegelijk draait
const downloadMutex = new Mutex();

async function fetchMetadata(url) {
    try {
        // Gebruik --dump-json om alleen metadata te krijgen
        const metadataJson = await ytDlpWrap.execPromise([
            url,
            '--skip-download',
            '--dump-json',
            '--quiet'
        ]);
        return JSON.parse(metadataJson);
    } catch (e) {
        console.error(`Error fetching metadata for ${url}:`, e.message);
        return null;
    }
}

async function downloadAudio(url, fileTemplate) {
    try {
        await ytDlpWrap.execPromise([
            url,
            '-f', 'bestaudio/best',
            '--postprocessor-args', 'ffmpeg:-threads 1', // Limiteer CPU op Pi Zero
            '--extract-audio',
            '--audio-format', CODEC,
            '--audio-quality', QUALITY,
            '-o', fileTemplate,
            '--quiet'
        ]);
        return true;
    } catch (e) {
        console.error(`Error downloading audio for ${url}:`, e.message);
        return false;
    }
}

// Deze functie wordt aangeroepen en NIET awaited
async function downloadSong(url) {
    let song;
    // Gebruik een IIFE (Immediately Invoked Function Expression) om de 'pending' song
    // te maken/vinden buiten de mutex lock
    try {
        song = await Song.findOne({ where: { original_url: url } });

        if (song && (song.status === DownloadStatus.COMPLETE || song.status === DownloadStatus.DOWNLOADING)) {
            console.log(`Song ${url} is al compleet of wordt gedownload.`);
            return song; // Bestaat al, doe niks
        }

        // 2. Haal metadata op
        const info = await fetchMetadata(url);
        if (!info) {
             throw new Error("Kon metadata niet ophalen.");
        }

        // 3. Maak (of update) DB entry aan
        if (!song) {
            song = await Song.create({
                title: info.title || 'Unknown Title',
                artist: info.artist || info.uploader || 'Unknown Artist',
                album: info.album,
                duration: info.duration,
                thumbnail_url: info.thumbnail,
                original_url: url,
                status: DownloadStatus.PENDING
            });
        } else {
            song.title = info.title || 'Unknown Title';
            song.artist = info.artist || info.uploader || 'Unknown Artist';
            song.album = info.album;
            song.duration = info.duration;
            song.thumbnail_url = info.thumbnail;
            song.status = DownloadStatus.PENDING;
            await song.save();
        }
    } catch (e) {
         console.error(`Fout bij voorbereiden download: ${e.message}`);
         if (song) {
            song.status = DownloadStatus.ERROR;
            song.error_message = e.message.substring(0, 255);
            await song.save();
         }
         return; // Stop als metadata al faalt
    }


    // Wacht op de lock
    const release = await downloadMutex.acquire(); 
    console.log(`Download lock verkregen voor: ${song.title}`);
    try {
        // Controleer opnieuw *binnen* de lock
        const freshSong = await Song.findByPk(song.id);
        if (freshSong.status === DownloadStatus.COMPLETE || freshSong.status === DownloadStatus.DOWNLOADING) {
             console.log(`Song ${freshSong.title} is al bezig/klaar (check binnen lock).`);
             release(); // Geef lock vrij
             return;
        }

        // 4. Update status naar 'DOWNLOADING'
        freshSong.status = DownloadStatus.DOWNLOADING;
        await freshSong.save();

        // 5. Start de daadwerkelijke download
        const fileTemplate = path.join(MUSIC_DIR, `${freshSong.id}.%(ext)s`);
        const success = await downloadAudio(url, fileTemplate);

        if (!success) {
            throw new Error("yt-dlp download/conversie mislukt.");
        }

        // 6. Zoek het gedownloade bestand
        const finalPath = path.join(MUSIC_DIR, `${freshSong.id}.${CODEC}`);
        // FIX: Sla het relatieve pad op in de DB
        const relativePath = path.join(config.music_directory, `${freshSong.id}.${CODEC}`);
        
        if (!fs.existsSync(finalPath)) {
            // Fallback (zeldzaam, maar kan gebeuren)
             const finalPathM4a = path.join(MUSIC_DIR, `${freshSong.id}.m4a`);
             if (fs.existsSync(finalPathM4a)) {
                  fs.renameSync(finalPathM4a, finalPath); // Hernoem
             } else {
                 throw new Error(`Output file ${finalPath} niet gevonden na download.`);
             }
        }
        
        // 7. Update DB naar 'COMPLETE'
        freshSong.file_path = relativePath; // Sla relatief pad op
        freshSong.status = DownloadStatus.COMPLETE;
        freshSong.error_message = null;
        await freshSong.save();
        
        console.log(`Download voltooid: ${freshSong.title}`);

    } catch (e) {
        // 8. Handel errors af
        console.error(`Download mislukt voor ${url}: ${e.message}`);
        if (song) {
            // Gebruik 'song' (de variabele die we hebben) om de status bij te werken
            await Song.update(
                { status: DownloadStatus.ERROR, error_message: e.message.substring(0, 255) },
                { where: { id: song.id } }
            );
        }
    } finally {
        release(); // Geef de lock vrij
        console.log(`Download lock vrijgegeven voor: ${song.title}`);
    }
}

module.exports = { downloadSong };