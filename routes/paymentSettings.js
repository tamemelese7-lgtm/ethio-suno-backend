const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const PaymentSettings = require('../models/PaymentSettings');
const User = require('../models/User');
const { auth } = require('../middleware/authMiddleware');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5242880 } });

async function getSettings() {
    let s = await PaymentSettings.findOne();
    if (!s) s = await PaymentSettings.create({});
    return s;
}

router.get('/', auth, async (req, res) => {
    try {
        const s = await getSettings();
        res.json({ accountName: s.accountName, telebirrNumber: s.telebirrNumber, cbeNumber: s.cbeNumber, cbeName: s.cbeName, qrImageUrl: s.qrImageUrl, shopName: s.shopName, shopNumber: s.shopNumber, shopQrImageUrl: s.shopQrImageUrl, note: s.note });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

router.put('/', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user || user.role !== 'admin') return res.status(403).json({ msg: 'አስተዳዳሪ ብቻ!' });
        const s = await getSettings();
        const { accountName, telebirrNumber, cbeNumber, cbeName, shopName, shopNumber, note } = req.body;
        if (accountName !== undefined) s.accountName = accountName;
        if (telebirrNumber !== undefined) s.telebirrNumber = telebirrNumber;
        if (cbeNumber !== undefined) s.cbeNumber = cbeNumber;
        if (shopName !== undefined) s.shopName = shopName;
        if (shopNumber !== undefined) s.shopNumber = shopNumber;
        if (cbeName !== undefined) s.cbeName = cbeName;
        if (note !== undefined) s.note = note;
        await s.save();
        res.json({ msg: 'ተስተካክሏል!', settings: s });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

router.post('/qr', auth, upload.single('qr'), async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user || user.role !== 'admin') return res.status(403).json({ msg: 'አስተዳዳሪ ብቻ!' });
        if (!req.file) return res.status(400).json({ msg: 'ምስል ይምረጡ!' });
        const uploaded = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream({ folder: 'ethiosuno_qr', resource_type: 'image' }, (err, result) => err ? reject(err) : resolve(result));
            stream.end(req.file.buffer);
        });
        const s = await getSettings();
        s.qrImageUrl = uploaded.secure_url;
        await s.save();
        res.json({ msg: 'QR ተስቀለ!', qrImageUrl: uploaded.secure_url });
    } catch (e) { console.error('QR error:', e.message); res.status(500).json({ msg: 'QR አልተሳካም!' }); }
});


router.post('/shop-qr', auth, upload.single('qr'), async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        const uploaded = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream({ folder: 'ethiosuno_qr', resource_type: 'image' }, (err, result) => err ? reject(err) : resolve(result));
            stream.end(req.file.buffer);
        });
        const s = await getSettings();
        s.shopQrImageUrl = uploaded.secure_url;
        await s.save();
        res.json({ msg: 'shop QR uploaded', shopQrImageUrl: uploaded.secure_url });
    } catch (e) { console.error('shop-qr:', e.message); res.status(500).json({ msg: 'upload failed' }); }
});

module.exports = router;
