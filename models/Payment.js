const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    packageName: {
        type: String,
        required: true
    },
    amount: {
        type: String,
        required: true
    },
    credits: {
        type: Number,
        required: true
    },
    payerPhone: {
        type: String,
        required: true
    },
    transactionId: {
        type: String,
        required: true,
        trim: true
    },
    screenshotUrl: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
        index: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    reviewedAt: {
        type: Date
    }
});

module.exports = mongoose.model('Payment', PaymentSchema);
