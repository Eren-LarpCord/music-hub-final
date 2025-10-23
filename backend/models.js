const { DataTypes, Model } = require('sequelize');

// Status Enum voor downloads
const DownloadStatus = {
    PENDING: "pending",
    DOWNLOADING: "downloading",
    COMPLETE: "complete",
    ERROR: "error"
};

module.exports = (sequelize) => {
    class Song extends Model {}
    Song.init({
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        title: {
            type: DataTypes.STRING,
            defaultValue: "Unknown Title"
        },
        artist: {
            type: DataTypes.STRING,
            defaultValue: "Unknown Artist"
        },
        album: {
            type: DataTypes.STRING,
            allowNull: true
        },
        duration: {
            type: DataTypes.INTEGER, // in seconden
            allowNull: true
        },
        original_url: {
            type: DataTypes.STRING,
            unique: true,
            allowNull: true // Toestaan voor MP3 uploads
        },
        file_path: {
            type: DataTypes.STRING,
            unique: true,
            allowNull: true
        },
        thumbnail_url: {
            type: DataTypes.STRING,
            allowNull: true
        },
        status: {
            type: DataTypes.ENUM(Object.values(DownloadStatus)),
            defaultValue: DownloadStatus.PENDING
        },
        error_message: {
            type: DataTypes.STRING,
            allowNull: true
        }
    }, { sequelize, modelName: 'song' }); // 'song' wordt 'songs' als tabelnaam

    class Playlist extends Model {}
    Playlist.init({
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        name: {
            type: DataTypes.STRING,
            unique: true,
            allowNull: false
        }
    }, { sequelize, modelName: 'playlist' }); // 'playlist' wordt 'playlists'

    return { Song, Playlist, DownloadStatus };
};