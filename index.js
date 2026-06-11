const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('EthioSuno AI Server Is Running Successfully!');
});

const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log('✅ MongoDB Database በተሳካ ሁኔታ ተገናኝቷል!');
        app.listen(PORT, () => console.log(`🚀 ሰርቨሩ በፖርት ${PORT} ላይ ተነስቷል!`));
    })
    .catch(err => console.error('❌ የዳታቤዝ ግንኙነት ስህተት:', err));
