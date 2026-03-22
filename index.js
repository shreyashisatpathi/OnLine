require('dotenv').config();
const qrcode = require('qrcode-terminal');

const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { createClient } = require('redis');

// ✅ Redis (FIX: use env, not hardcoded)
const redis = createClient({
    url: process.env.REDIS_URL
});

redis.on('error', (err) => console.log('Redis Error:', err));

(async () => {
    await redis.connect();
    console.log('✅ Connected to Redis');
})();

// Queue state (kept but mostly unused now)
let queue = [];
let servingToken = null;

// ================= START BAILEYS =================

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;

        if (qr) {
            console.log("📱 Scan this QR:");
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log('✅ WhatsApp Connected!');
        }

        if (connection === 'close') {
            console.log('❌ Connection closed, retrying...');
            startBot(); // auto reconnect
        }
    });

    sock.ev.on('creds.update', saveCreds);

    console.log('🚀 WhatsApp Queue Bot is Ready!');

    // ================= MESSAGE HANDLER =================

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const sender = msg.key.remoteJid;

        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            "";

        const input = text.toLowerCase().trim();

        console.log("📩", sender, input);

        // Fake contact (Baileys doesn’t give full contact easily)
        const user = {
            id: sender,
            number: sender.split('@')[0],
            name: "User"
        };

        // ================= USER COMMANDS =================

        if (input === 'hi') {
            const userId = sender;
            const name = user.name;

            const exists = await redis.hExists('queue:users', userId);

            if (exists) {
                const data = JSON.parse(await redis.hGet('queue:users', userId));
                return sock.sendMessage(sender, {
                    text: `⚠️ Already in queue. Token #${data.token}`
                });
            }

            const token = await redis.incr('token:counter');

            const userData = { id: userId, name, token };

            await redis.rPush('queue:list', JSON.stringify(userData));
            await redis.hSet('queue:users', userId, JSON.stringify(userData));

            return sock.sendMessage(sender, {
                text: `🎫 Hi ${name}! Your token number is #${token}`
            });
        }

        if (input === 'status') {
            const userId = sender;

            const data = await redis.hGet('queue:users', userId);

            if (!data) {
                return sock.sendMessage(sender, {
                    text: '❌ Not in queue'
                });
            }

            const user = JSON.parse(data);

            const list = await redis.lRange('queue:list', 0, -1);
            const index = list.findIndex(u => JSON.parse(u).id === userId);

            return sock.sendMessage(sender, {
                text: `📊 Token #${user.token}, Position ${index + 1}`
            });
        }

        if (input === 'exit') {
            // remove from redis list (simple version)
            const list = await redis.lRange('queue:list', 0, -1);
            const filtered = list.filter(u => JSON.parse(u).id !== sender);

            await redis.del('queue:list');
            if (filtered.length > 0) {
                await redis.rPush('queue:list', filtered);
            }

            await redis.hDel('queue:users', sender);

            return sock.sendMessage(sender, {
                text: '✅ You have left the queue'
            });
        }

        // ================= ADMIN =================

        if (user.number === process.env.ADMIN) {

            if (input === 'next') {
                const next = await redis.lPop('queue:list');

                if (!next) {
                    return sock.sendMessage(sender, {
                        text: '🚫 Queue empty'
                    });
                }

                const user = JSON.parse(next);

                await redis.hDel('queue:users', user.id);

                await sock.sendMessage(user.id, {
                    text: `🔔 Your turn! Token #${user.token}`
                });

                return sock.sendMessage(sender, {
                    text: `➡️ Serving token #${user.token}`
                });
            }

            if (input === 'current') {
                return sock.sendMessage(sender, {
                    text: servingToken
                        ? `🎯 Currently serving #${servingToken}`
                        : 'No active token'
                });
            }

            if (input === 'reset') {
                await redis.del('queue:list');
                await redis.del('queue:users');
                await redis.del('token:counter');

                return sock.sendMessage(sender, {
                    text: '♻️ Queue reset'
                });
            }
        }
    });
}

startBot();