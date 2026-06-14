const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Payment = require('../models/Payment');
const { auth, adminOnly } = require('../middleware/authMiddleware');

// 💳 POST /submit
router.post('/submit', auth, async (req, res) => {
    try {
        const { packageName, amount, credits, payerPhone, transactionId, screenshot } = req.body;
        if (!packageName || !amount || !credits || !payerPhone || !transactionId) {
            return res.status(400).json({ msg: 'ሁሉንም መረጃ ይሙሉ!' });
        }

        const dup = await Payment.findOne({ transactionId: transactionId.trim() });
        if (dup) {
            return res.status(400).json({ msg: 'ይህ ትራንዛክሽን ቁጥር ቀድሞ ተልኳል!' });
        }

        const payment = new Payment({
            user: req.userId,
            packageName,
            amount,
            credits,
            payerPhone,
            transactionId: transactionId.trim(),
            screenshotUrl: screenshot || '',
            status: 'pending'
        });
        await payment.save();

        res.status(201).json({
            msg: 'ማረጋገጫዎ ተልኳል! ሰርቨሩ ሲያረጋግጥ ክሬዲት ይጨመራል።',
            payment
        });
    } catch (err) {
        console.error('Payment Submit Error:', err.message);
        res.status(500).json({ msg: 'ሰርቨር ስህተት!' });
    }
});

// 📋 GET /my
router.get('/my', auth, async (req, res) => {
    try {
        const payments = await Payment.find({ user: req.userId }).sort({ createdAt: -1 });
        res.json({ payments });
    } catch (err) {
        res.status(500).json({ msg: 'ሰርቨር ስህተት!' });
    }
});

// 👑 GET /pending
router.get('/pending', auth, adminOnly, async (req, res) => {
    try {
        const payments = await Payment.find({ status: 'pending' })
            .populate('user', 'fullName phone')
            .sort({ createdAt: -1 });
        res.json({ payments });
    } catch (err) {
        res.status(500).json({ msg: 'ሰርቨር ስህተት!' });
    }
});

// 👑 POST /approve/:id
router.post('/approve/:id', auth, adminOnly, async (req, res) => {
    try {
        const payment = await Payment.findById(req.params.id);
        if (!payment) return res.status(404).json({ msg: 'ክፍያ አልተገኘም!' });
        if (payment.status !== 'pending') {
            return res.status(400).json({ msg: 'ይህ ክፍያ ቀድሞ ተስተናግዷል!' });
        }

        const user = await User.findById(payment.user);
        if (!user) return res.status(404).json({ msg: 'ተጠቃሚ አልተገኘም!' });

        user.credits += payment.credits;
        await user.save();

        payment.status = 'approved';
        payment.reviewedAt = new Date();
        await payment.save();

        res.json({ msg: `${payment.credits} ክሬዲት ተጨምሯል!`, payment });
    } catch (err) {
        res.status(500).json({ msg: 'ሰርቨር ስህተት!' });
    }
});

// 👑 POST /reject/:id
router.post('/reject/:id', auth, adminOnly, async (req, res) => {
    try {
        const payment = await Payment.findById(req.params.id);
        if (!payment) return res.status(404).json({ msg: 'ክፍያ አልተገኘም!' });

        payment.status = 'rejected';
        payment.reviewedAt = new Date();
        await payment.save();

        res.json({ msg: 'ክፍያ ተቀባይነት አላገኘም።', payment });
    } catch (err) {
        res.status(500).json({ msg: 'ሰርቨር ስህተት!' });
    }
});

module.exports = router;
