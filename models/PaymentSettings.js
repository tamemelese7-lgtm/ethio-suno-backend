const mongoose = require('mongoose');

const paymentSettingsSchema = new mongoose.Schema({
    accountName:    { type: String, default: 'አቤል ብርሃኑ' },
    telebirrNumber: { type: String, default: '0911223344' },
    cbeName:        { type: String, default: '' },
    cbeNumber:      { type: String, default: '' },
    shopName:       { type: String, default: '' },
    shopNumber:     { type: String, default: '' },
    qrImageUrl:     { type: String, default: '' },
    shopQrImageUrl: { type: String, default: '' },
    note:           { type: String, default: '' },
    updatedAt:      { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('PaymentSettings', paymentSettingsSchema);
