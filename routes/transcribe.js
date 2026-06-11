const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const { auth } = require('../middleware/authMiddleware');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }, // Whisper max 25MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('audio/')) cb(null, true);
        else cb(new Error('የድምጽ ፋይል ብቻ ይፈቀዳል!'));
    }
});

const tLimiter = rateLimit({ windowMs: 60*1000, max: 3, message: { msg: 'ቀስ ይበሉ! በደቂቃ 3 ጊዜ ብቻ።' } });

router.post('/lyrics', auth, tLimiter, upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ msg: 'የድምጽ ፋይል ያስፈልጋል!' });
        if (!process.env.OPENAI_API_KEY) return res.status(500).json({ msg: 'OpenAI አልተሰናዳም!' });

        const form = new FormData();
        form.append('file', req.file.buffer, { filename: req.file.originalname || 'audio.mp3', contentType: req.file.mimetype });
        form.append('model', 'whisper-1');
        // language auto-detect (Amharic, etc.) - Whisper detects automatically

        const wRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
            headers: { ...form.getHeaders(), 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
            timeout: 120000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        const lyrics = wRes.data?.text || '';
        res.json({ msg: 'ግጥም ተወጣ!', lyrics });
    } catch (err) {
        console.error('Transcribe Error:', err.message);
        if (err.message && err.message.includes('የድምጽ')) return res.status(400).json({ msg: err.message });
        if (err.response) { console.error('OpenAI:', JSON.stringify(err.response.data)); return res.status(err.response.status || 500).json({ msg: 'Transcription ስህተት!', detail: err.response.data }); }
        res.status(500).json({ msg: 'ግጥም ማውጣት አልተቻለም!' });
    }
});

module.exports = router;
