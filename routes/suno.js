const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const User = require('../models/User');
const Song = require('../models/Song');
const { auth } = require('../middleware/authMiddleware');

// ===== AUTO MASTERING =====
const ffmpegPath = require('ffmpeg-static');
const { execFile } = require('child_process');
const _fs = require('fs');
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
function uploadMastered(buffer) {
  return new Promise((resolve, reject) => {
    const st = cloudinary.uploader.upload_stream({ resource_type: 'video', folder: 'ethiosuno_mastered' }, (err, result) => err ? reject(err) : resolve(result));
    st.end(buffer);
  });
}
async function masterAudio(audioUrl) {
  if (!audioUrl) return null;
  const ts = Date.now() + '_' + Math.floor(Math.random()*9999);
  const inPath = '/tmp/m_in_' + ts + '.mp3';
  const outPath = '/tmp/m_out_' + ts + '.mp3';
  try {
    const resp = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 60000 });
    _fs.writeFileSync(inPath, Buffer.from(resp.data));
    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, ['-y','-nostats','-loglevel','error','-i',inPath,'-af','highpass=f=20,equalizer=f=45:width_type=h:g=14,equalizer=f=110:width_type=o:width=1.4:g=9,equalizer=f=2500:width_type=o:width=1.5:g=1,equalizer=f=6000:width_type=h:g=-8,loudnorm=I=-13:TP=-1.5:LRA=11','-b:a','192k',outPath], { timeout: 300000, maxBuffer: 1024 * 1024 * 100 }, (err) => err ? reject(err) : resolve());
    });
    const buf = _fs.readFileSync(outPath);
    const up = await uploadMastered(buf);
    console.log('Mastered OK:', up && up.secure_url);
    return (up && up.secure_url) || null;
  } catch (e) {
    console.error('Master error:', e.message);
    return null;
  } finally {
    try { if (_fs.existsSync(inPath)) _fs.unlinkSync(inPath); } catch(e){}
    try { if (_fs.existsSync(outPath)) _fs.unlinkSync(outPath); } catch(e){}
  }
}
// ===== end mastering =====


// 🛡️ Generate rate limit — በደቂቃ 3 ጥሪ ብቻ
const generateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    message: { msg: 'ቀስ ይበሉ! በደቂቃ 3 ጊዜ ብቻ መፍጠር ይችላሉ።' },
    standardHeaders: true,
    legacyHeaders: false
});

// vocal_gender ('m'/'f') only works on chirp models
const GENDER_MODELS = ['chirp-v4-5', 'chirp-v4-5-plus', 'chirp-v5'];
const VALID_MODELS = ['sonic-v3-5', 'sonic-v4', 'sonic-v4-5', 'sonic-v4-5-plus', 'sonic-v5', 'sonic-v5-5', 'chirp-v4-5', 'chirp-v4-5-plus', 'chirp-v5'];

// map frontend model choice → chirp equivalent (so vocal_gender works)
function resolveModel(model, vocalGender) {
    const wantsGender = (vocalGender === 'm' || vocalGender === 'f');
    // when a specific voice is requested, must use chirp models
    if (wantsGender) {
        if (model === 'sonic-v5' || model === 'sonic-v5-5' || model === 'chirp-v5') return 'chirp-v5';
        if (model === 'sonic-v4-5-plus' || model === 'chirp-v4-5-plus') return 'chirp-v4-5-plus';
        return 'chirp-v4-5';
    }
    // no voice requested → keep chosen sonic model (default v4-5)
    return VALID_MODELS.includes(model) ? model : 'sonic-v4-5';
}

// ====================================================
// 🎵 POST /generate — ሙዚቃ ማምረት (native aimusicapi sonic)
// ====================================================
router.post('/generate', auth, generateLimiter, async (req, res) => {
    try {
        const { lyrics, style, title, vocalGender, model, styleWeight, weirdness } = req.body;
        if (!lyrics || !style) {
            return res.status(400).json({ msg: 'ግጥምና ስልት ያስፈልጋሉ!' });
        }

        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ msg: 'ተጠቃሚ አልተገኘም!' });
        if (user.role !== 'admin' && user.credits < 1) {
            return res.status(400).json({ msg: 'በቂ ክሬዲት የለዎትም! ክሬዲት ይግዙ።' });
        }
        if (!process.env.SUNO_API_KEY || !process.env.SUNO_BASE_URL) {
            return res.status(500).json({ msg: 'Suno API አልተሰናዳም!' });
        }

        // choose model — switches to chirp when a voice is requested
        const mv = resolveModel(model, vocalGender);

        // build create body
        const body = {
            custom_mode: true,
            mv,
            title: title || 'Untitled',
            tags: style,
            prompt: lyrics
        };
        // add vocal_gender only when chosen AND model supports it
        if ((vocalGender === 'm' || vocalGender === 'f') && GENDER_MODELS.includes(mv)) {
            body.vocal_gender = vocalGender;
        }
        // advanced controls (0–1). only add when valid numbers
        const sw = parseFloat(styleWeight);
        if (!isNaN(sw) && sw >= 0 && sw <= 1) body.style_weight = sw;
        const wd = parseFloat(weirdness);
        if (!isNaN(wd) && wd >= 0 && wd <= 1) body.weirdness_constraint = wd;

        // Step 1: Create
        const createRes = await axios.post(
            `${process.env.SUNO_BASE_URL}/api/v1/sonic/create`,
            body,
            { headers: { 'Authorization': `Bearer ${process.env.SUNO_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
        );

        const created = createRes.data;
        const taskId = created?.data?.task_id || created?.task_id || created?.data?.id || created?.id;
        if (!taskId) {
            return res.status(500).json({ msg: 'Suno ምላሽ አልተሰጠም!', detail: created });
        }

        // Step 2: Poll  /api/v1/sonic/task/{task_id}  → data is ARRAY, state === 'succeeded'
        let clips = null;
        for (let i = 0; i < 40; i++) {
            await new Promise(r => setTimeout(r, 5000));
            try {
                const st = await axios.get(
                    `${process.env.SUNO_BASE_URL}/api/v1/sonic/task/${taskId}`,
                    { headers: { 'Authorization': `Bearer ${process.env.SUNO_API_KEY}` }, timeout: 15000,
                      validateStatus: s => s < 600 }  // don't throw on 4xx/5xx — handle below
                );
                const payload = st.data || {};
                // still processing
                if (payload.type === 'not_ready' || payload.error === 'task not ready, please wait few seconds.') {
                    continue;
                }
                const data = payload.data || [];
                const arr = Array.isArray(data) ? data : (data ? [data] : []);
                const ready = arr.find(c => c && c.state === 'succeeded' && (c.audio_url || c.audioUrl));
                if (ready) { clips = arr; break; }
                const errClip = arr.find(c => c && (c.state === 'failed' || c.state === 'error'));
                if (errClip) return res.status(500).json({ msg: 'Suno ማምረት ሳይሳካ ቀርቷል!' });
                // any other transient response → keep polling
            } catch (e) {
                console.error(`Poll ${i + 1}:`, e.message);
            }
        }
        if (!clips) return res.status(504).json({ msg: 'ሙዚቃው ጊዜ አልፎበታል! ደግሞ ይሞክሩ።' });

        // Step 3: Credit ቀነስ + DB save
        // Step 3: Credit ቀነስ (admin unlimited) + DB save
        if (user.role !== 'admin') {
            user.credits -= 1;
            await user.save();
        }

        const first = clips[0] || {};
        try {
          const mastered = await masterAudio(first.audio_url || first.audioUrl);
          if (mastered) { first.audio_url = mastered; first.audioUrl = mastered; }
        } catch (e) { console.error('Mastering skipped:', e.message); }
        const song = new Song({
            user: user._id,
            title: title || first.title || 'Untitled',
            style,
            lyrics,
            audioUrl: first.audio_url || first.audioUrl || '',
            imageUrl: first.image_url || first.imageUrl || '',
            duration: first.duration || 0,
            status: 'complete'
        });
        await song.save();

        res.json({
            msg: 'ሙዚቃው ተፈጥሯል!',
            remainingCredits: user.credits,
            song: song,
            audioData: clips
        });
    } catch (err) {
        console.error('Generate Error:', err.message);
        if (err.response) console.error('Detail:', JSON.stringify(err.response.data));
        if (err.code === 'ECONNABORTED') {
            return res.status(504).json({ msg: 'ጥሪው ጊዜ አልፎበታል! ደግሞ ይሞክሩ።' });
        }
        if (err.response) {
            return res.status(err.response.status || 500).json({ msg: 'ከSuno API ስህተት!', detail: err.response.data });
        }
        res.status(500).json({ msg: 'ከSuno API ጋር መገናኘት አልተቻለም!' });
    }
});

// ====================================================
// 📚 GET /songs — የራስን ዘፈኖች ማግኘት
// ====================================================
router.get('/songs', auth, async (req, res) => {
    try {
        const songs = await Song.find({ user: req.userId }).sort({ createdAt: -1 }).limit(100);
        res.json({ songs });
    } catch (err) {
        res.status(500).json({ msg: 'ሰርቨር ስህተት!' });
    }
});

// ====================================================
// 🗑️ DELETE /songs/:id
// ====================================================
router.delete('/songs/:id', auth, async (req, res) => {
    try {
        const song = await Song.findOne({ _id: req.params.id, user: req.userId });
        if (!song) return res.status(404).json({ msg: 'ዜማ አልተገኘም!' });
        await song.deleteOne();
        res.json({ msg: 'ዜማ ተሰርዟል!' });
    } catch (err) {
        res.status(500).json({ msg: 'ሰርቨር ስህተት!' });
    }
});


router.get('/public', async (req, res) => {
    try {
        const songs = await Song.find({ isPublic: true, audioUrl: { $ne: '' } })
            .populate('user', 'fullName')
            .sort({ createdAt: -1 })
            .limit(100);
        res.json({ songs });
    } catch (e) { res.status(500).json({ msg: 'server error' }); }
});

router.post('/songs/:id/toggle-public', auth, async (req, res) => {
    try {
        const song = await Song.findById(req.params.id);
        if (String(song.user) !== String(req.userId)) return res.status(403).json({ msg: 'not your song' });
        song.isPublic = !song.isPublic;
        await song.save();
        res.json({ msg: 'updated', isPublic: song.isPublic });
    } catch (e) { res.status(500).json({ msg: 'server error' }); }
});

// 🎚️ POST /master — manual mastering
router.post('/master', auth, async (req, res) => {
  try {
    const { audioUrl } = req.body;
    if (!audioUrl) return res.status(400).json({ msg: 'audioUrl ያስፈልጋል!' });
    const mastered = await masterAudio(audioUrl);
    if (!mastered) return res.status(500).json({ msg: 'Mastering አልተሳካም!' });
    res.json({ msg: 'ድምጹ ተስተካክሏል!', audioUrl: mastered });
  } catch (e) {
    console.error('Master endpoint:', e.message);
    res.status(500).json({ msg: 'ስህተት!' });
  }
});

module.exports = router;

