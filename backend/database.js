const { Sequelize } = require('sequelize');
const fs = require('fs');
const path = require('path'); // Path toegevoegd

// Lees config voor de database URL
// FIX: Gebruik een absoluut pad om config.json te vinden
const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const dbPath = config.database_url.replace('sqlite:', ''); // Verwijder "sqlite:" prefix

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, '..', dbPath), // FIX: Maak absoluut pad voor DB
    logging: false, // Zet op true voor debuggen
});

// Importeer modellen *nadat* sequelize is gedefinieerd
const defineModels = require('./models');
// FIX: Vang DownloadStatus hier op
const { Song, Playlist, DownloadStatus } = defineModels(sequelize);

// Definieer de Many-to-Many relatie
Song.belongsToMany(Playlist, { through: 'playlist_song' });
Playlist.belongsToMany(Song, { through: 'playlist_song' });

async function initDb() {
    // sync() maakt de tabellen aan als ze niet bestaan
    await sequelize.sync(); 
}

// FIX: Geef DownloadStatus hier door
module.exports = { sequelize, initDb, Song, Playlist, DownloadStatus };