const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const { Client, GatewayIntentBits } = require("discord.js");

// dotenv allows me to easily acces .env file for secrets
require('dotenv').config();

// What name should the bot use for itsself?
const me = "blumpkin"
// Dictionary that stores JId : metadata (whatsapp groups)
let groupIdName = {};
// Global variable storing the whatsapp socket
let sock;
// Discord connection status
let discordStatus = false;
// The bot could technically be put in multiple servers.
// This is a hacky solution.
// We have a global variable guild which will be set when the first message (in the discord) to the bot is sent.
// From the first message, the bot will derive what server it is meant to be communicating in.
// If the bot is started, and a whatsapp message fires before the first discord message, the bot will crash:
// Becuase it doesn't know what guild it is supposed to be in yet.
let guild;


function sendDiscordMessageChannel(channelId, messageContent, supposedAuthor) {
  // Get the channel from its Id and then send a message
  client.channels.cache.get(channelId).send(`**${supposedAuthor}**: ${messageContent}`);
}


function handleDiscordMessage(message) {
  // This is the piece that sets the global guild variable
  guild = message.guild;

  // Message info for later
  const messageContent = message.content;
  const messageAuthor = message.author.username;
  const channelId = message.channelId;
  const channelName = message.channel.name;

  // Debug
  console.log(`${messageAuthor}: ${messageContent} in ${channelName}`);

  // Sort messages: commands, and the default of the switch case is behavior for regular messages
  switch(messageContent) {
    case "!ping":
      sendDiscordMessageChannel(channelId, "Pong", me);
      break;
    case "!info":
      sendDiscordMessageChannel(channelId, `Server: ${message.guild.name}, Members: ${message.guild.memberCount}`, me)
      break;
    default:
      // Right now, we don't have a lot of groups in the community, so looping over them is okay.
      // A better solution would be to have a names -> JId dictionary as well, to ensure O(1) here, as opposed to
      // O(N) currently.
      for (let key in Object.keys(groupIdName)) {
        const realKey = Object.keys(groupIdName)[key];
        console.log(groupIdName[realKey].subject.toLowerCase(), channelName);
        if(groupIdName[realKey].subject.toLowerCase() == channelName) {
          sendWhatsappMessage(realKey, messageContent, messageAuthor);
        }
      }
      break;
  }
  return;
}


// Send whatsapp message. Pretty self explanatory
async function sendWhatsappMessage(groupJid, messageContent, supposedAuthor) {
  console.log(`Going to send ${messageContent} by ${supposedAuthor} in ${groupIdName[groupJid].subject}`)
  try {
    await sock.sendMessage(groupJid, { text: `*${supposedAuthor}*: ${messageContent}` })
  } catch(error) {
    console.log("Error sending message to whatsapp: ", error);
  }
}


function handleWhatsappMessage(groupJid, messageContent, supposedAuthor) {
  // Again - commands first with the switch case, then default behavior is the behavior for regular messages
  switch(messageContent) {
    case "!ping":
      sendWhatsappMessage(groupJid, "pong", me);
      break;
    case "!status":
      sendWhatsappMessage(groupJid,  `I am ${(discordStatus == true)  ? "" : "not"} connected to the discord.`, me);
      break;
    default:
      // This is syntactical magic
      const channel = guild.channels.cache.find(ch => ch.name === groupIdName[groupJid].subject.toLowerCase());
      sendDiscordMessageChannel(channel.id, messageContent, supposedAuthor);
      break;
  } 
}





// Folder auth_info has auth info. duh
async function connectToWhatsApp() {
    useMultiFileAuthState('auth_info').then(({ state, saveCreds }) => {
        sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }), // debug
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
                });
            }

            if (connection === 'open') {
                console.log('Successfully connected to WhatsApp!');
                // Initialize the JId -> metadata dictionary
                const groups = await sock.groupFetchAllParticipating();
                for (let b in groups) {
                  const metadata = await sock.groupMetadata(b);
                  if (metadata.groupDesc == "This year will be hype") continue;
                  groupIdName[b] = metadata;
                }
            }

            // This is not interesting
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
            if (type !== 'notify') return; // Only handle notifications
            for (const msg of messages) {
                const from = msg.key.remoteJid; // The holy JId
                const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text; // messagetext duh
                const metadata = groupIdName[from]; // idk if this is actually metadata. I dont remember what i was doing
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

// Set callback for message event
client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  handleDiscordMessage(message);
});
