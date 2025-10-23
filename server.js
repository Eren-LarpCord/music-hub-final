const express = require('express');
const path = require('path');
const fs = require('fs');
const { initDb, sequelize } = require('./backend/database');
const apiRoutes = require('./backend/routes');

// Maak mappen als ze niet bestaan
const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
fs.mkdirSync(config.music_directory, { recursive: true });
fs.mkdirSync(config.data_directory, { recursive: true });

const app = express();
const PORT = 3000; // Zoals gevraagd

// Middleware
// Nodig voor Form data (URL toevoegen)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Koppel de API routes
app.use('/api', apiRoutes);

// Serveer de frontend
app.use('/static', express.static(path.join(__dirname, 'frontend')));

// Serveer het hoofd-HTML-bestand
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Start de server
async function startServer() {
    try {
        await initDb();
        console.log('Database geïnitialiseerd.');
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`MusicHub Lite (Node.js) draait op http://0.0.0.0:${PORT}`);
        });
    } catch (error) {
        console.error('Kon server niet starten:', error);
    }
}

startServer();