const mongoose = require('mongoose');
const SongSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, default: 'Untitled' },
    style: { type: String, required: true, trim: true },
    lyrics: { type: String, default: '' },
    audioUrl: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    duration: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'complete', 'error'], default: 'complete' },
    isPublic: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Song', SongSchema);
