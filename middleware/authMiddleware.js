const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = async (req, res, next) => {
    const authHeader = req.header('Authorization');
    if (!authHeader) return res.status(401).json({ msg: 'ፍቃድ የለዎትም! ይግቡ።' });
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ msg: 'Token ፎርማት ስህተት!' });
    try {
        const decoded = jwt.verify(parts[1], process.env.JWT_SECRET);
        req.userId = decoded.id;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') return res.status(401).json({ msg: 'ሴሽን አልፏል። ይግቡ!' });
        return res.status(401).json({ msg: 'Token ስህተት!' });
    }
};
const adminOnly = async (req, res, next) => {
    try {
        const user = await User.findById(req.userId);
        if (!user || user.role !== 'admin') return res.status(403).json({ msg: 'Admin ፍቃድ ያስፈልጋል!' });
        next();
    } catch (err) {
        res.status(500).json({ msg: 'ሰርቨር ስህተት!' });
    }
};
module.exports = { auth, adminOnly };
