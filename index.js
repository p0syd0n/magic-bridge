const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const { Client, GatewayIntentBits } = require("discord.js");
require('dotenv').config();
const me = "blumpkin"
let groupIdName = {};
let sock;
let discordStatus = false;
let guild;

function sendDiscordMessageChannel(channelId, messageContent, supposedAuthor) {
  client.channels.cache.get(channelId).send(`**${supposedAuthor}**: ${messageContent}`);
}


function handleDiscordMessage(message) {
  guild = message.guild;
  const messageContent = message.content;
  const messageAuthor = message.author.username;
  const channelId = message.channelId;
  const channelName = message.channel.name;
  console.log(`${messageAuthor}: ${messageContent} in ${channelName}`);
  switch(messageContent) {
    case "!ping":
      sendDiscordMessageChannel(channelId, "Pong", me);
      break;
    case "!info":
      sendDiscordMessageChannel(channelId, `Server: ${message.guild.name}, Members: ${message.guild.memberCount}`, me)
      break;
    default:
      for (let key in Object.keys(groupIdName)) {
        const realKey = Object.keys(groupIdName)[key];

        console.log(groupIdName[realKey].subject.toLowerCase(), channelName);
        if(groupIdName[realKey].subject.toLowerCase() == channelName) {
          sendWhatsappMessage(realKey, messageContent, messageAuthor);
        }
      }
      break;
  }
}



async function sendWhatsappMessage(groupJid, messageContent, supposedAuthor) {
  console.log("groupdJID: ", groupJid);
  console.log(`Going to send ${messageContent} by ${supposedAuthor} in ${groupIdName[groupJid].subject}`)
  try {
    await sock.sendMessage(groupJid, { text: `*${supposedAuthor}*: ${messageContent}` })
  } catch(error) {
    console.log("Error sending message to whatsapp: ", error);
  }
}


function handleWhatsappMessage(groupJid, messageContent, supposedAuthor) {
  console.log(groupIdName);
  console.log("here it is, ", groupIdName[groupJid]);
  switch(messageContent) {
    case "!ping":
      sendWhatsappMessage(groupJid, "pong", me);
    case "!status":
      sendWhatsappMessage(groupJid,  `I am ${(discordStatus == true)  ? "" : "not"} connected to the discord.`, me);
    default:
      const channel = guild.channels.cache.find(ch => ch.name === groupIdName[groupJid].subject.toLowerCase());
      console.log("HERE GOES CHANNEP\n\n\n\n", channel);
      sendDiscordMessageChannel(channel.id, messageContent, supposedAuthor);
      break;
  } 
}






async function connectToWhatsApp() {
    useMultiFileAuthState('auth_info').then(({ state, saveCreds }) => {
        sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }), // Debug logging for troubleshooting
            connectTimeoutMs: 30000, // 30-second timeout
        });

        // Handle connection updates and QR code
        sock.ev.on('connection.update', async (update) => {
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
                const groups = await sock.groupFetchAllParticipating();
                for (let b in groups) {
                  const metadata = await sock.groupMetadata(b);
                  if (metadata.groupDesc == "This year will be hype") continue;
                  groupIdName[b] = metadata;
                }
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
                const metadata = groupIdName[from];
                console.log(`Message from ${msg.pushName} (${from}): ${text}`);
                 
                handleWhatsappMessage(from, text, msg.pushName);                 
            }
        });
    }).catch((err) => {
        console.error('Failed to start:', err);
        process.exit(1);
    });
}


// Create new discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
  ],
});
// Have him log in to discord with the bot token, discord will automatically redirect him to the guild
client.login(process.env.BOT_TOKEN).catch((error) => {
    console.log("Failed to log in as the bot");
})

// Start connection to whatsapp
connectToWhatsApp();

// Discord Ready notification
client.once('ready', () => {
    console.log(`Logged into discord as ${client.user.tag}`);
    discordStatus = true;
})


client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  handleDiscordMessage(message);
});
