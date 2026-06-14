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
const SUNO = process.env.SUNO_BASE_URL;
const HEAD = { 'Authorization': 'Bearer ' + process.env.SUNO_API_KEY, 'Content-Type': 'application/json' };

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

    console.log('Uploading audio to MusicAPI...');
    const upRes = await axios.post(SUNO + '/api/v1/sonic/upload', { url: audioUrl }, { headers: HEAD, timeout: 60000 });
    console.log('Upload response:', JSON.stringify(upRes.data));
    const ud = upRes.data && (upRes.data.data || upRes.data);
    let clipId = (ud && (ud.clip_id || (Array.isArray(ud) && ud[0] && ud[0].clip_id))) || null;
    let upTask = (ud && (ud.task_id || ud.id)) || upRes.data.task_id || null;
    if (!clipId && upTask) {
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 8000));
        try {
          const t = await axios.get(SUNO + '/api/v1/sonic/task/' + upTask, { headers: HEAD, timeout: 15000 });
          const a = t.data && t.data.data;
          const l = Array.isArray(a) ? a : (a ? [a] : []);
          if (l[0] && l[0].clip_id) { clipId = l[0].clip_id; break; }
        } catch (e) { console.error('UpPoll:', e.message); }
      }
    }
    if (!clipId) return res.status(500).json({ msg: 'Audio upload አልተሳካም!', detail: upRes.data });
    console.log('Uploaded clip_id:', clipId);

    console.log('Creating cover...');
    const coverRes = await axios.post(SUNO + '/api/v1/sonic/create',
      { task_type: 'cover_upload_music', continue_clip_id: clipId, custom_mode: true, mv: 'sonic-v4-5', prompt: lyrics || '[Verse]', title: title || 'Cover', tags: style },
      { headers: HEAD, timeout: 120000 });
    console.log('Create response:', JSON.stringify(coverRes.data));
    const cd = coverRes.data && (coverRes.data.data || coverRes.data);
    const taskId = (cd && (cd.task_id || cd.id)) || coverRes.data.task_id;
    if (!taskId) return res.status(500).json({ msg: 'Task ID አልተገኘም!', detail: coverRes.data });

    let songs = null;
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 15000));
      try {
        const taskRes = await axios.get(SUNO + '/api/v1/sonic/task/' + taskId, { headers: HEAD, timeout: 15000 });
        const arr = taskRes.data && taskRes.data.data;
        const list = Array.isArray(arr) ? arr : (arr ? [arr] : []);
        console.log('Cover Poll ' + (i+1) + ':', list[0] && list[0].state);
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
      console.error('API:', JSON.stringify(err.response.data));
      const det = ((err.response.data && (err.response.data.detail || err.response.data.message)) || '').toString().toLowerCase();
      if (det.includes('existing recording') || det.includes('catalog') || det.includes('copyright')) {
        return res.status(400).json({ msg: 'ይህ ድምጽ copyright ያለው የታወቀ ዘፈን ነው። እባክዎ የራስዎን original ድምጽ ይጠቀሙ።' });
      }
      return res.status(err.response.status || 500).json({ msg: 'Suno API ስህተት!', detail: err.response.data });
    }
    res.status(500).json({ msg: 'ስህተት ተፈጥሯል!' });
  }
});

module.exports = router;
