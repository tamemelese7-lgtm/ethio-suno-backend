const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({
    fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    phone: { type: String, unique: true, sparse: true, trim: true, minlength: 7, maxlength: 16 },
    password: { type: String, minlength: 6 },
    email: { type: String, unique: true, sparse: true, trim: true, lowercase: true },
    googleId: { type: String, unique: true, sparse: true },
    avatar: { type: String, default: '' },
    credits: { type: Number, default: 2, min: 0 },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    lang: { type: String, default: 'am' },
    securityQuestion: { type: String, default: '' },
    securityAnswer: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});
UserSchema.methods.toSafeJSON = function () {
    return { id: this._id, fullName: this.fullName, phone: this.phone, email: this.email, avatar: this.avatar, credits: this.credits, role: this.role, lang: this.lang };
};
module.exports = mongoose.model('User', UserSchema);
