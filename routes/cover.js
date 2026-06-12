cat > routes/cover.js << 'ENDOFFILE'
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const User = require('../models/User');
const Song = require('../models/Song');
const { auth } = require('../middleware/authMiddleware');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('audio/')) cb(null, true);
        else cb(new Error('የድምጽ ፋይል ብቻ ይፈቀዳል!'));
    }
});

const coverLimiter = rateLimit({ windowMs: 60*1000, max: 2, message: { msg: 'ቀስ ይበሉ! በደቂቃ 2 ጊዜ ብቻ።' } });

function uploadToCloudinary(buffer) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { resource_type: 'video', folder: 'ethiosuno_uploads' },
            (err, result) => err ? reject(err) : resolve(result)
        );
        stream.end(buffer);
    });
}

router.post('/cover', auth, coverLimiter, upload.single('audio'), async (req, res) => {
    try {
        const { style, title, lyrics } = req.body;
        if (!req.file) return res.status(400).json({ msg: 'የድምጽ ፋይል ያስፈልጋል!' });
        if (!style) return res.status(400).json({ msg: 'ስልት ያስፈልጋል!' });

        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ msg: 'ተጠቃሚ አልተገኘም!' });
        if (user.credits < 1) return res.status(400).json({ msg: 'በቂ ክሬዲት የለዎትም!' });

        console.log('Uploading to Cloudinary...');
        const cloud = await uploadToCloudinary(req.file.buffer);
        const audioUrl = cloud.secure_url;
        console.log('Cloudinary URL:', audioUrl);

        const coverRes = await axios.post(process.env.SUNO_BASE_URL + '/api/v1/sonic/upload-cover',
            { url: audioUrl, mv: 'sonic-v4-5', custom_mode: true, prompt: lyrics || '[Verse]', title: title || 'Cover', tags: style },
            { headers: { 'Authorization': 'Bearer ' + process.env.SUNO_API_KEY, 'Content-Type': 'application/json' }, timeout: 120000 });

        const taskId = coverRes.data?.task_id;
        if (!taskId) return res.status(500).json({ msg: 'Task ID አልተገኘም!', detail: coverRes.data });

        let songs = null;
        for (let i = 0; i < 24; i++) {
            await new Promise(r => setTimeout(r, 15000));
            try {
                const taskRes = await axios.get(process.env.SUNO_BASE_URL + '/api/v1/sonic/task/' + taskId,
                    { headers: { 'Authorization': 'Bearer ' + process.env.SUNO_API_KEY }, timeout: 15000 });
                const arr = taskRes.data?.data;
                const list = Array.isArray(arr) ? arr : (arr ? [arr] : []);
                console.log('Cover Poll ' + (i+1) + ':', list[0]?.state);
                if (list.length && list.every(s => s.state === 'succeeded')) { songs = list; break; }
                if (list.some(s => s.state === 'failed')) return res.status(500).json({ msg: 'ማደስ ሳይሳካ ቀርቷል!' });
            } catch (e) { console.error('Poll:', e.message); }
        }
        if (!songs) return res.status(504).json({ msg: 'ጊዜ አልፎበታል!' });

        const first = songs[0] || {};
        user.credits -= 1;
        await user.save();
        const song = new Song({ user: user._id, title: title || 'Cover', style, lyrics: lyrics || '',
            audioUrl: first.audio_url || '', imageUrl: first.image_url || '', duration: first.duration || 0, status: 'complete' });
        await song.save();

        res.json({ msg: 'ሙዚቃው ታድሷል!', remainingCredits: user.credits, song, audioData: songs });
    } catch (err) {
        console.error('Cover Error:', err.message);
        if (err.message && err.message.includes('የድምጽ')) return res.status(400).json({ msg: err.message });
        if (err.code === 'ECONNABORTED') return res.status(504).json({ msg: 'ጥሪው ጊዜ አልፎበታል!' });
        if (err.response) {
            const data = err.response.data || {};
            const upErr = (data && data.steps && data.steps.upload && data.steps.upload.error) || data.detail || data.message || '';
            console.error('API:', JSON.stringify(data));
            if (data.failed_step === 'upload' || /catalog|existing recording|HTTP 400/i.test(upErr)) {
                return res.status(422).json({ msg: 'ይህ ድምጽ የታወቀ/የቅጂመብት ሙዚቃ ሊሆን ይችላል። እባክዎ የራስዎን ኦርጂናል ድምጽ ይሞክሩ።' });
            }
            return res.status(err.response.status || 500).json({ msg: 'Suno API ስህተት!', detail: data });
        }
        res.status(500).json({ msg: 'ስህተት ተፈጥሯል!' });
    }
});

module.exports = router;
