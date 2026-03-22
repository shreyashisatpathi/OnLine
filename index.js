const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
require('dotenv').config();

const { createClient } = require('redis');
REDIS_URL='redis://default:hYAjyzANNi1fCL3XB6FMRtZUvFty5UTl@redis-19329.crce286.ap-south-1-1.ec2.cloud.redislabs.com:19329'

const redis = createClient({
    url: REDIS_URL
});

redis.on('error', (err) => console.log('Redis Error:', err));

(async () => {
    await redis.connect();
    console.log('✅ Connected to Redis 123');
})();

// Queue state
let queue = [];
let currentToken = 1;
let servingToken = null;

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: '/usr/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ WhatsApp Queue Bot is Ready!');
});

// Helper: check if user already in queue
const findUser = (user) => {
    return queue.find(q => q.user === user);
};

const handleMessage = async (msg) => {
    if (msg.fromMe) {
        console.log("📤 From Me:", msg.body);
    }
    const text = msg.body.toLowerCase().trim();

    const contact = await msg.getContact();

    const user = {
        id: msg.from,                
        number: contact.number || "",
        name: contact.pushname || "User"
    };
    console.log("Message:", text);

    // ================ USER COMMANDS =================

    // Join queue

    if (text === 'hi') {
        const contact = await msg.getContact();

        const userId = msg.from;
        const name = contact.pushname || "User";

        // Check if already exists (FAST)
        const exists = await redis.hExists('queue:users', userId);

        if (exists) {
            const data = JSON.parse(await redis.hGet('queue:users', userId));
            return msg.reply(`⚠️ Already in queue. Token #${data.token}`);
        }

        const token = await redis.incr('token:counter');

        const userData = { id: userId, name, token };

        // Save in both places
        await redis.rPush('queue:list', JSON.stringify(userData));
        await redis.hSet('queue:users', userId, JSON.stringify(userData));

        return msg.reply(`🎫 Hi ${name}! Your token number is #${token}\nPeople ahead: ${queue.length - 1}`);
    }
    // Check status
    if (text === 'status') {
        const userId = msg.from;

        const data = await redis.hGet('queue:users', userId);

        if (!data) {
            return msg.reply('❌ Not in queue');
        }

        const user = JSON.parse(data);

        const list = await redis.lRange('queue:list', 0, -1);
        const index = list.findIndex(u => JSON.parse(u).id === userId);

        return msg.reply(`📊 Token #${user.token}, Position ${index + 1}`);
    }

    // Exit queue
    if (text === 'exit') {
        const index = queue.findIndex(q => q.user === user);

        if (index === -1) {
            return msg.reply('❌ You are not in queue');
        }

        queue.splice(index, 1);
        return msg.reply('✅ You have left the queue');
    }

    // ================= ADMIN COMMANDS =================

    // ⚠️ Replace with your number

    if (user.number === process.env.ADMIN) {
        // Call next token
        if (text === 'next') {
            const next = await redis.lPop('queue:list');

            if (!next) {
                return msg.reply('🚫 Queue empty');
            }

            const user = JSON.parse(next);

            // ❗ Remove from hash too
            await redis.hDel('queue:users', user.id);

            await client.sendMessage(
                user.id,
                `🔔 Your turn! Token #${user.token}`
            );

            return msg.reply(`➡️ Serving token #${user.token}`);
        }

        // Current serving
        if (text === 'current') {
            return msg.reply(
                servingToken
                    ? `🎯 Currently serving #${servingToken}`
                    : 'No active token'
            );
        }

        // Reset queue
        if (text === 'reset') {
            await redis.del('queue:list');
            await redis.del('queue:users');
            await redis.del('token:counter');

            return msg.reply('♻️ Queue reset');
        }
    }
};

client.on('message', handleMessage);
client.on('message_create', msg => {
    if (msg.fromMe) handleMessage(msg);
});



client.initialize();