const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');
dotenv.config();
const phone = process.argv[2];
const amount = parseInt(process.argv[3]) || 10;
mongoose.connect(process.env.MONGO_URI).then(async () => {
    const user = await User.findOne({ phone: phone.trim() });
    if (!user) { console.log('❌ አልተገኘም!'); process.exit(1); }
    user.credits += amount;
    await user.save();
    console.log('✅ ' + amount + ' ክሬዲት ተጨመረ! አሁን: ' + user.credits);
    process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
