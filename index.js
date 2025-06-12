const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const { Client, GatewayIntentBits } = require("discord.js");
require('dotenv').config();


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
  ],
});

client.login(process.env.BOT_TOKEN).catch((error) => {
    console.log("Failed to log in as the bot");
})



function connectToWhatsApp() {
    useMultiFileAuthState('auth_info').then(({ state, saveCreds }) => {
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }), // Debug logging for troubleshooting
            connectTimeoutMs: 30000, // 30-second timeout
        });

        // Handle connection updates and QR code
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                // Generate QR code with qrcode package
                qrcode.toString(qr, { type: 'terminal', small: true }, (err, qrString) => {
                    if (err) {
                        console.error('Failed to generate QR code:', err);
                        return;
                    }
                    console.log('Scan this QR code with WhatsApp:\n', qrString);
                    // Optionally save QR code as an image
                    qrcode.toFile('qr.png', qr, { type: 'png' }, (err) => {
                        if (err) console.error('Failed to save QR code image:', err);
                        else console.log('QR code saved as qr.png');
                    });
                });
            }

            if (connection === 'open') {
                console.log('Successfully connected to WhatsApp!');
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                console.error('Disconnected:', lastDisconnect?.error);
                if (reason === DisconnectReason.connectionClosed || reason === 515) {
                    console.log('Reconnecting in 5 seconds...');
                    setTimeout(connectToWhatsApp, 5000);
                } else if (reason === DisconnectReason.loggedOut) {
                    console.error('Logged out. Delete auth_info and rescan QR code.');
                } else {
                    console.error('Unknown disconnection reason. Manual restart required.');
                }
            }
        });

        // Save credentials
        sock.ev.on('creds.update', saveCreds);

        // Handle incoming messages
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            for (const msg of messages) {
                const from = msg.key.remoteJid;
                const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
                console.log(`Message from ${msg.pushName} (${from}): ${text}`);
                if (text?.toLowerCase() === 'ping') {
                    try {
                        await sock.sendMessage(from, { text: 'pong' });
                    } catch (error) {
                        console.error('Failed to send message:', error);
                    }
                }
            }
        });
    }).catch((err) => {
        console.error('Failed to start:', err);
        process.exit(1);
    });
}

// Start connection
connectToWhatsApp();
client.once('ready', () => {
    console.log(`Logged into discord as ${client.user.tag}`)
})
