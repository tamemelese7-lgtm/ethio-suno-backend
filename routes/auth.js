const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth } = require('../middleware/authMiddleware');
const { OAuth2Client } = require('google-auth-library');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '208746106474-0rkea5puvl2tlu3et5h0voi2bvf1ld9l.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 10, message: { msg: 'ብዙ ሙከራ! ከ15 ደቂቃ በኋላ ይሞክሩ።' } });
function makeToken(user) { return jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' }); }
router.post('/register', authLimiter, async (req, res) => {
    try {
        const { fullName, phone, password, securityQuestion, securityAnswer } = req.body;
        if (!fullName || !phone || !password) return res.status(400).json({ msg: 'ሁሉንም ይሙሉ!' });
        if (fullName.trim().length < 2) return res.status(400).json({ msg: 'ስም ቢያንስ 2 ቁምፊ!' });
        const cleanPhone = phone.trim().replace(/\s+/g, '');
        if (cleanPhone.length < 7 || cleanPhone.length > 16) return res.status(400).json({ msg: 'ትክክለኛ ስልክ ቁጥር!' });
        if (password.length < 6) return res.status(400).json({ msg: 'የይለፍ ቃል ቢያንስ 6 ቁምፊ!' });
        if (await User.findOne({ phone: cleanPhone })) return res.status(400).json({ msg: 'ይህ ስልክ ቀድሞ ተመዝግቧል!' });
        const salt = await bcrypt.genSalt(10);
        const user = new User({ fullName: fullName.trim(), phone: cleanPhone, password: await bcrypt.hash(password, salt), securityQuestion: (securityQuestion||'').trim(), securityAnswer: (securityAnswer||'').trim().toLowerCase() });
        await user.save();
        res.status(201).json({ msg: 'ምዝገባ ተሳክቷል!', token: makeToken(user), user: user.toSafeJSON() });
    } catch (err) { console.error('Register:', err.message); res.status(500).json({ msg: 'ሰርቨር ስህተት!' }); }
});
router.post('/login', authLimiter, async (req, res) => {
    try {
        const { phone, password } = req.body;
        if (!phone || !password) return res.status(400).json({ msg: 'ስልክና የይለፍ ቃል ያስፈልጋሉ!' });
        const cleanPhone = phone.trim().replace(/\s+/g, '');
        const user = await User.findOne({ phone: cleanPhone });
        if (!user) return res.status(400).json({ msg: 'ስልክ ወይም የይለፍ ቃል ተሳስቷል!' });
        if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ msg: 'ስልክ ወይም የይለፍ ቃል ተሳስቷል!' });
        res.json({ token: makeToken(user), user: user.toSafeJSON() });
    } catch (err) { console.error('Login:', err.message); res.status(500).json({ msg: 'ሰርቨር ስህተት!' }); }
});
router.get('/me', auth, async (req, res) => {
    try { const user = await User.findById(req.userId); if (!user) return res.status(404).json({ msg: 'አልተገኘም!' }); res.json({ user: user.toSafeJSON() }); }
    catch (err) { res.status(500).json({ msg: 'ሰርቨር ስህተት!' }); }
});
router.put('/profile', auth, async (req, res) => {
    try {
        const { fullName, avatar, lang } = req.body;
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ msg: 'አልተገኘም!' });
        if (fullName && fullName.trim().length >= 2) user.fullName = fullName.trim();
        if (typeof avatar === 'string') user.avatar = avatar;
        if (lang) user.lang = lang;
        await user.save();
        res.json({ msg: 'ተዘምኗል!', user: user.toSafeJSON() });
    } catch (err) { res.status(500).json({ msg: 'ሰርቨር ስህተት!' }); }
});

// Forgot — phone ላክ → security question ይመለሳል
router.post('/forgot', authLimiter, async (req, res) => {
    try {
        const cleanPhone = (req.body.phone||'').trim();
        const user = await User.findOne({ phone: cleanPhone });
        if (!user) return res.status(404).json({ msg: 'ይህ ስልክ አልተመዘገበም!' });
        if (!user.securityQuestion) return res.status(400).json({ msg: 'የደህንነት ጥያቄ የለም። አስተዳዳሪ ያነጋግሩ።' });
        res.json({ question: user.securityQuestion });
    } catch (e) { res.status(500).json({ msg: 'server error' }); }
});

// Reset — phone + answer → new password
router.post('/reset', authLimiter, async (req, res) => {
    try {
        const cleanPhone = (req.body.phone||'').trim();
        const answer = (req.body.answer||'').trim().toLowerCase();
        const newPassword = req.body.newPassword||'';
        if (newPassword.length < 6) return res.status(400).json({ msg: 'የይለፍ ቃል ቢያንስ 6 ፊደл!' });
        const user = await User.findOne({ phone: cleanPhone });
        if (!user) return res.status(404).json({ msg: 'ይህ ስልክ አልተመዘገበም!' });
        if ((user.securityAnswer||'').toLowerCase() !== answer) return res.status(400).json({ msg: 'የደህንነት መልስ ተሳስቷል!' });
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();
        res.json({ msg: 'የይለፍ ቃل ተቀይሯл! ይግቡ።' });
    } catch (e) { res.status(500).json({ msg: 'server error' }); }
});


router.post('/google', authLimiter, async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ msg: 'Google token የለም!' });
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = (payload.email || '').toLowerCase();
    const name = (payload.name || 'Google User').slice(0, 60);
    if (!email) return res.status(400).json({ msg: 'Email አልተገኘም!' });
    let user = await User.findOne({ $or: [{ googleId: googleId }, { email: email }] });
    if (!user) {
      user = new User({ fullName: name, email: email, googleId: googleId });
      await user.save();
    } else if (!user.googleId) {
      user.googleId = googleId;
      if (!user.email) user.email = email;
      await user.save();
    }
    res.json({ token: makeToken(user), user: user.toSafeJSON() });
  } catch (err) {
    console.error('Google:', err.message);
    res.status(401).json({ msg: 'Google መግባት አልተሳካም!' });
  }
});

module.exports = router;
