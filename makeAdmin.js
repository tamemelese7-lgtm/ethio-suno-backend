const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');
dotenv.config();
const phone = process.argv[2];
if (!phone) { console.log('❌ ስልክ ቁጥር ያስገቡ! ምሳሌ: node makeAdmin.js +251911223344'); process.exit(1); }
mongoose.connect(process.env.MONGO_URI).then(async () => {
    const user = await User.findOne({ phone: phone.trim() });
    if (!user) { console.log('❌ ' + phone + ' አልተገኘም!'); process.exit(1); }
    user.role = 'admin';
    await user.save();
    console.log('✅ ' + user.fullName + ' (' + phone + ') አሁን Admin ሆኗል! 👑');
    process.exit(0);
}).catch(err => { console.error('❌', err.message); process.exit(1); });
