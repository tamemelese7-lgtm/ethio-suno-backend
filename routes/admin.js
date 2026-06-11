const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Song = require('../models/Song');
const Payment = require('../models/Payment');
const { auth } = require('../middleware/authMiddleware');

router.get('/stats', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user || user.role !== 'admin') return res.status(403).json({ msg: 'admin only' });
        const totalUsers = await User.countDocuments();
        const totalSongs = await Song.countDocuments();
        const pendingPayments = await Payment.countDocuments({ status: 'pending' });
        const approvedPayments = await Payment.find({ status: 'approved' });
        let revenue = 0;
        approvedPayments.forEach(p => { const n = parseInt((p.amount||'').replace(/[^0-9]/g,'')) || 0; revenue += n; });
        res.json({ totalUsers, totalSongs, pendingPayments, approvedCount: approvedPayments.length, revenue });
    } catch (e) { res.status(500).json({ msg: 'server error' }); }
});

module.exports = router;
