require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// Empêche le bot de crash sur les erreurs Discord non gérées
client.on('error', (err) => console.error('Discord error:', err.message));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err?.message || err));

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CONFIG = {
  AUTO_ROLE_ID:          '1504518488839032933',

  // Tickets
  TICKET_CHANNEL_ID:     '1504517754089115880',
  CATEGORY_SUPPORT_ID:   '1504519390480306347',
  CATEGORY_PURCHASE_ID:  '1504519236956065843',

  // Status — STATUS_CATEGORY_ID est la catégorie "Products" qui contient les produits
  // Le salon STATUS_CHANNEL_ID est EXCLU du panel (c'est le salon d'affichage)
  STATUS_CHANNEL_ID:     '1504517951116673164',
  STATUS_CATEGORY_ID:    '1504517890290876707',
  NEWS_CHANNEL_ID:       '1504517272121643119',

  // Rules
  RULES_CHANNEL_ID:      '1504517364358840482',

  // Dev role (only role allowed to use /setstatus and /key)
  DEV_ROLE_ID:           '1504518854355976362',

  // Salon où la commande /key est autorisée
  KEY_CHANNEL_ID:        '1504550882375897268',

  // Salon produit DayZ
  DAYZ_PRODUCT_CHANNEL_ID: '1504658380244127775',

  // Salon produit Valorant — remplace par le vrai ID de ton salon
  VALORANT_PRODUCT_CHANNEL_ID: 'VALORANT_CHANNEL_ID_ICI',
};
// ───────────────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');
const https = require('https');

// ── Helper pour appeler l'API Railway ─────────────────────────────────────
function callAPI(endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'r3volt-api-production.up.railway.app',
      port: 443,
      path: endpoint,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Persistent status store ────────────────────────────────────────────────
const STATUS_FILE = path.join(__dirname, 'statuses.json');

function loadStatuses() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Could not load statuses.json:', e.message);
  }
  return {};
}

function saveStatuses() {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(productStatuses, null, 2));
  } catch (e) {
    console.error('Could not save statuses.json:', e.message);
  }
}

const productStatuses = loadStatuses();
console.log(`📂 Loaded ${Object.keys(productStatuses).length} saved status(es)`);

// ── Register slash commands (called after ready to access guild channels) ──
async function registerCommands(guild) {
  // Build product choices dynamically from Products category (exclude status display channel)
  const productChannels = guild.channels.cache
    .filter(c =>
      c.parentId === CONFIG.STATUS_CATEGORY_ID &&
      c.id !== CONFIG.STATUS_CHANNEL_ID &&
      c.type === ChannelType.GuildText
    )
    .sort((a, b) => a.position - b.position);

  const productChoices = productChannels.map(c => ({
    name: formatChannelName(c.name),
    value: c.name,
  })).slice(0, 25);

  if (productChoices.length === 0) {
    productChoices.push({ name: 'No products', value: 'none' });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('setstatus')
      .setDescription('Update a product status (Dev only)')
      .addStringOption(opt =>
        opt.setName('product')
          .setDescription('Select a product')
          .setRequired(true)
          .addChoices(...productChoices)
      )
      .addStringOption(opt =>
        opt.setName('status')
          .setDescription('New status')
          .setRequired(true)
          .addChoices(
            { name: '🟢 Undetected', value: 'Undetected' },
            { name: '🔵 Updating',   value: 'Updating'   },
            { name: '🟡 Testing',    value: 'Testing'    },
          )
      ),

    new SlashCommandBuilder()
      .setName('menukeys')
      .setDescription('Gérer les clés (Dev only)')
      .addStringOption(opt =>
        opt.setName('action')
          .setDescription('Action à effectuer')
          .setRequired(true)
          .addChoices(
            { name: '🔍 Voir toutes les clés', value: 'list' },
            { name: '❄️ Geler une clé',        value: 'freeze' },
            { name: '🗑️ Supprimer une clé',    value: 'delete' },
            { name: '🔓 Reset HWID',            value: 'resethwid' },
          )
      )
      .addStringOption(opt =>
        opt.setName('key')
          .setDescription('Clé concernée (pour geler/supprimer/reset)')
          .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName('key')
      .setDescription('Generate a license key (Dev only)')
      .addStringOption(opt =>
        opt.setName('produit')
          .setDescription('Nom du produit')
          .setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('duree')
          .setDescription('Durée de la clé')
          .setRequired(true)
          .addChoices(
            { name: '1 Day',    value: '1day'     },
            { name: '1 Week',   value: '1week'    },
            { name: '1 Month',  value: '1month'   },
            { name: 'Lifetime', value: 'lifetime' },
          )
      ),
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands });
    console.log('✅ Slash commands registered with ' + productChoices.length + ' product(s)');
  } catch (err) {
    console.error('Error registering commands:', err);
  }
}

// ── Auto-role on member join ───────────────────────────────────────────────
client.on('guildMemberAdd', async (member) => {
  try {
    const role = member.guild.roles.cache.get(CONFIG.AUTO_ROLE_ID);
    if (role) {
      await member.roles.add(role);
      console.log(`✅ Role assigned to ${member.user.tag}`);
    }
  } catch (err) {
    console.error('Auto-role error:', err);
  }
});

// ── Ready ──────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  // Register commands for each guild with dynamic product choices
  for (const guild of client.guilds.cache.values()) {
    await registerCommands(guild);
  }
  await postTicketPanel();
  await postStatusPanel();
  await postRules();
  await postDayZProduct();
  await postValorantProduct();
});

// ═══════════════════════════════════════════════════════════════════════════
//  DAYZ PRODUCT PANEL
// ═══════════════════════════════════════════════════════════════════════════
async function postDayZProduct() {
  try {
  console.log('⏳ Posting DayZ product panel...');
  const channel = await client.channels.fetch(CONFIG.DAYZ_PRODUCT_CHANNEL_ID).catch((e) => {
    console.error('❌ DayZ channel fetch error:', e.message);
    return null;
  });
  if (!channel) return console.warn('⚠️  DayZ product channel not found (ID: ' + CONFIG.DAYZ_PRODUCT_CHANNEL_ID + ')');
  console.log('✅ DayZ channel found:', channel.name);

  const msgs = await channel.messages.fetch({ limit: 20 }).catch((e) => {
    console.error('❌ DayZ fetch messages error:', e.message);
    return new Map();
  });
  for (const m of msgs.filter(m => m.author.id === client.user.id).values()) await m.delete().catch(() => {});

  const embed = new EmbedBuilder()
    .setTitle('DayZ')
    .setDescription([
      '-# Radar DMA',
      '',
      '**Radar**',
      '',
      '__Players:__',
      '• Position',
      '• Name',
      '• Distance',
      '',
      '__Zombies:__',
      '• Position',
      '• Distance',
      '• Max Distance',
      '',
      '__Animals:__',
      '• Position',
      '• Distance',
      '',
      '**Loot**',
      '',
      '• Select Categories (Weapons, Clothing, Ammo…)',
      '• Cars , Boats',
      '• Dead Players',
      '• Dead Animals',
      '',
      '**Price**',
      '',
      '• Lifetime — 10€',
    ].join('\n'))
    .setColor(0xe74c3c)
    .setFooter({ text: 'R3VOLT • DayZ DMA' })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch((e) => console.error('❌ DayZ send error:', e.message));
  console.log('✅ DayZ product panel posted');
  } catch (e) {
    console.error('❌ postDayZProduct crashed:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  VALORANT PRODUCT PANEL
// ═══════════════════════════════════════════════════════════════════════════
async function postValorantProduct() {
  try {
    console.log('⏳ Posting Valorant product panel...');
    const channel = await client.channels.fetch(CONFIG.VALORANT_PRODUCT_CHANNEL_ID).catch((e) => {
      console.error('❌ Valorant channel fetch error:', e.message);
      return null;
    });
    if (!channel) return console.warn('⚠️  Valorant product channel not found (ID: ' + CONFIG.VALORANT_PRODUCT_CHANNEL_ID + ')');
    console.log('✅ Valorant channel found:', channel.name);

    const msgs = await channel.messages.fetch({ limit: 20 }).catch(() => new Map());
    for (const m of msgs.filter(m => m.author.id === client.user.id).values()) await m.delete().catch(() => {});

    const embed = new EmbedBuilder()
      .setTitle('Valorant')
      .setDescription([
        '-# IA VALORANT — Intelligence Artificielle',
        '',
        '**Aim Assistance**',
        '',
        '• Aim Assist IA — prédiction de trajectoire',
        '• Triggerbot — détection automatique de cible',
        '• Recoil Control — compensation du recul',
        '',
        '**Visuals / ESP**',
        '',
        '• Player ESP — boîtes, squelette, santé, distance',
        '• Wallhack — visibilité à travers les obstacles',
        '• Radar 2D — position de tous les joueurs',
        '• Sound ESP — visualisation des sons de pas',
        '',
        '**Utilities**',
        '',
        '• Spike Tracker — localisation en temps réel',
        '• Compatible tous agents & toutes maps',
        '',
        '**Price**',
        '',
        '• Lifetime — 15€',
      ].join('\n'))
      .setColor(0xff4655)
      .setFooter({ text: 'R3VOLT • Valorant IA' })
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch((e) => console.error('❌ Valorant send error:', e.message));
    console.log('✅ Valorant product panel posted');
  } catch (e) {
    console.error('❌ postValorantProduct crashed:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  TICKET PANEL — un seul select menu: produits Purchase + Support
// ═══════════════════════════════════════════════════════════════════════════
async function postTicketPanel() {
  const channel = await client.channels.fetch(CONFIG.TICKET_CHANNEL_ID).catch(() => null);
  if (!channel) return console.warn('⚠️  Ticket channel not found.');

  const msgs = await channel.messages.fetch({ limit: 20 });
  for (const m of msgs.filter(m => m.author.id === client.user.id).values()) await m.delete().catch(() => {});

  const guild = channel.guild;

  // Produits depuis la catégorie Purchase
  const purchaseChannels = guild.channels.cache
    .filter(c => c.parentId === CONFIG.CATEGORY_PURCHASE_ID && c.type === ChannelType.GuildText)
    .sort((a, b) => a.position - b.position);

  const options = purchaseChannels.size > 0
    ? purchaseChannels.map(c =>
        new StringSelectMenuOptionBuilder()
          .setValue(`purchase__${c.id}`)
          .setLabel(formatChannelName(c.name))
          .setDescription('For purchase • questions • support')
          .setEmoji('🛒')
      )
    : [
        new StringSelectMenuOptionBuilder()
          .setValue('purchase__default')
          .setLabel('Purchase')
          .setDescription('For purchase • questions • support')
          .setEmoji('🛒'),
      ];

  // Option Support à la fin
  options.push(
    new StringSelectMenuOptionBuilder()
      .setValue('support__general')
      .setLabel('Support')
      .setDescription('For questions • technical issues • support')
      .setEmoji('🔧'),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId('ticket_select')
    .setPlaceholder('⚡ Choose a solution...')
    .addOptions(options);

  const embed = new EmbedBuilder()
    .setTitle('🎫  Open a Ticket')
    .setDescription('Select a product to purchase or open a support ticket.')
    .setColor(0xe74c3c)
    .setFooter({ text: 'R3volt • Ticket System' })
    .setTimestamp();

  await channel.send({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select)],
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  STATUS PANEL — grille 3 colonnes, exclut le salon "status" lui-même
// ═══════════════════════════════════════════════════════════════════════════
async function postStatusPanel(guild) {
  const channel = await client.channels.fetch(CONFIG.STATUS_CHANNEL_ID).catch(() => null);
  if (!channel) return console.warn('⚠️  Status channel not found.');

  if (!guild) guild = channel.guild;

  const msgs = await channel.messages.fetch({ limit: 20 });
  for (const m of msgs.filter(m => m.author.id === client.user.id).values()) await m.delete().catch(() => {});

  const statusChannels = guild.channels.cache
    .filter(c =>
      c.parentId === CONFIG.STATUS_CATEGORY_ID &&
      c.type === ChannelType.GuildText &&
      c.id !== CONFIG.STATUS_CHANNEL_ID  // exclut le salon d'affichage
    )
    .sort((a, b) => a.position - b.position)
    .map(c => c);

  const fields = statusChannels.map(c => {
    const status = productStatuses[c.id] || 'Undetected';
    return {
      name:   `${statusDot(status)} ${formatChannelName(c.name)}`,
      value:  `\`\`\`\n${status}\n\`\`\``,
      inline: true,
    };
  });

  // Complète la dernière ligne pour que Discord affiche correctement
  const remainder = fields.length % 3;
  if (remainder !== 0) {
    for (let i = 0; i < 3 - remainder; i++) {
      fields.push({ name: '\u200b', value: '\u200b', inline: true });
    }
  }

  if (fields.length === 0) {
    fields.push({ name: 'No products', value: '*Category is empty*', inline: false });
  }

  const embed = new EmbedBuilder()
    .setTitle('📊 Current Product Status')
    .setColor(0xe74c3c)
    .addFields(fields)
    .setFooter({ text: 'Last updated' })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}


// ═══════════════════════════════════════════════════════════════════════════
//  RULES PANEL
// ═══════════════════════════════════════════════════════════════════════════
async function postRules() {
  const channel = await client.channels.fetch(CONFIG.RULES_CHANNEL_ID).catch(() => null);
  if (!channel) return console.warn('Rules channel not found.');

  const msgs = await channel.messages.fetch({ limit: 20 });
  for (const m of msgs.filter(m => m.author.id === client.user.id).values()) await m.delete().catch(() => {});

  const rulesText = [
    '1) All sales are final, and refunds will not be provided unless there is a exception.',
    '2) Any fraudulent activities or related actions are strictly prohibited.',
    '3) You are responsible for keeping track of your key/login and their security.',
    '4) Our products must be used responsibly, misuse or abuse will not be tolerated.',
    '5) Do not ask for our developers or seek to communicate with them in any way.',
    '6) DM advertising will result in a permanent ban.',
    '7) Doxing/DDoSing will result in an permanent ban.',
    '8) Sending harmful materials of any kind will result in a permanent ban.',
    '9) Self promoting & DM advertising will result in a permanent ban.',
    '10) Discussion of other providers is strictly prohibited and may result in a ban.',
    '11) Our products must be referred to as "chair" at all times.',
    '12) Engaging in any conversation that violates Discord TOS is strictly prohibited.',
    '13) Any discussion of harmful or inappropriate topics is strictly prohibited.',
    '14) Most importantly, we expect our users to use common sense at all times.',
  ].join('\n');

  const intro = [
    'We do not condone or encourage actions that have the potential to cause harm of any type on any other user (mentally or physically).',
    'We do not take any responsibilities for the actions they take when using our tools.',
    'We only encourage ethical use of our tool, as they were made for educational reasons.',
    'Furthermore, we do not endorse any of the content present in this server that is not in an official manner from a verified staff member.',
  ].join(' ');

  const embed = new EmbedBuilder()
    .setTitle('Rules & Terms of Services')
    .setDescription(
      intro + '\n\n' +
      rulesText
    )
    .addFields(
      {
        name: 'Discord TOS & Guidelines',
        value: '[ https://discord.com/terms ]\n[ https://discord.com/guidelines ]',
      },

    )
    .setFooter({
      text: 'By purchasing and using our products, you acknowledge and agree to abide by our Terms of Service and Rules. If you cannot comply with our terms, please refrain from using our products.',
    })
    .setColor(0xe74c3c);

  await channel.send({ embeds: [embed] });
  console.log('Rules posted');
}

// ═══════════════════════════════════════════════════════════════════════════
//  INTERACTIONS
// ═══════════════════════════════════════════════════════════════════════════
client.on('interactionCreate', async (interaction) => {

  // ── Select menu ticket (purchase + support) ────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
    await interaction.deferReply({ ephemeral: true });
    const value = interaction.values[0];
    const [type, refId] = value.split('__');
    const { guild, member } = interaction;

    let ticketName, categoryId, embedTitle, embedDesc, embedColor;

    if (type === 'purchase') {
      const refChannel  = guild.channels.cache.get(refId);
      const productName = refChannel ? refChannel.name : 'purchase';
      ticketName  = `purchase-${productName}-${member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      categoryId  = CONFIG.CATEGORY_PURCHASE_ID;
      embedTitle  = `🛒  Purchase Ticket — ${formatChannelName(productName)}`;
      embedDesc   = `Welcome <@${member.id}>!\n\n💬 Describe what you want to purchase and a staff member will assist you shortly.`;
      embedColor  = 0x2ecc71;
    } else {
      ticketName  = `support-${member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      categoryId  = CONFIG.CATEGORY_SUPPORT_ID;
      embedTitle  = `🔧  Support Ticket`;
      embedDesc   = `Welcome <@${member.id}>!\n\n💬 Describe your issue and a staff member will assist you shortly.`;
      embedColor  = 0x3498db;
    }

    // Anti-doublon
    const existing = guild.channels.cache.find(c => c.name === ticketName);
    if (existing) return interaction.editReply({ content: `❌ You already have an open ticket: <#${existing.id}>` });

    const ticketChannel = await guild.channels.create({
      name: ticketName,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      ],
    });

    const ticketEmbed = new EmbedBuilder()
      .setTitle(embedTitle)
      .setDescription(embedDesc)
      .setColor(embedColor)
      .setFooter({ text: 'R3volt • Click Close Ticket to close this ticket' })
      .setTimestamp();

    await ticketChannel.send({ content: `<@${member.id}>`, embeds: [ticketEmbed], components: [closeRow()] });
    await interaction.editReply({ content: `✅ Your ticket has been created: <#${ticketChannel.id}>` });
  }

  // ── Close ticket button ────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'ticket_close') {
    await interaction.reply({ content: '🔒 Closing ticket in 5 seconds…' });
    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
  }

  // ── /menukeys ──────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'menukeys') {
    const hasDevRole = interaction.member.roles.cache.has(CONFIG.DEV_ROLE_ID);
    if (!hasDevRole) return interaction.reply({ content: '❌ Réservé aux **Développeurs**.', ephemeral: true });

    const action = interaction.options.getString('action');
    const key    = interaction.options.getString('key');

    try {
      if (action === 'list') {
        const result = await callAPI('/keys/list-all', { secret: process.env.API_SECRET || 'r3volt-secret-change-me' });
        const keys = result.keys || {};
        const entries = Object.entries(keys);
        if (entries.length === 0) return interaction.reply({ content: '📭 Aucune clé enregistrée.', ephemeral: true });
        const lines = entries.map(([k, v]) => {
          const status = v.frozen ? '❄️ Gelée' : '✅ Active';
          const exp = v.expiresAt ? `<t:${Math.floor(v.expiresAt/1000)}:R>` : '♾️';
          return `${status} \`${k}\` — **${v.product}** | ${v.username || '?'} | ${exp}`;
        }).join('\n');
        const embed = new EmbedBuilder()
          .setTitle(`🔑 Clés enregistrées (${entries.length})`)
          .setDescription(lines.slice(0, 4000))
          .setColor(0x7c3aed)
          .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if ((action === 'freeze' || action === 'delete' || action === 'resethwid') && !key) {
        return interaction.reply({ content: '❌ Tu dois spécifier une clé avec l\'option `key`.', ephemeral: true });
      }

      if (action === 'freeze') {
        const result = await callAPI('/keys/freeze', { secret: process.env.API_SECRET || 'r3volt-secret-change-me', key });
        if (!result.success) return interaction.reply({ content: `❌ Clé introuvable : \`${key}\``, ephemeral: true });
        return interaction.reply({ content: `❄️ Clé **gelée** : \`${key}\``, ephemeral: true });
      }

      if (action === 'delete') {
        const result = await callAPI('/keys/revoke', { secret: process.env.API_SECRET || 'r3volt-secret-change-me', key });
        if (!result.success) return interaction.reply({ content: `❌ Clé introuvable : \`${key}\``, ephemeral: true });
        return interaction.reply({ content: `🗑️ Clé **supprimée** : \`${key}\``, ephemeral: true });
      }

      if (action === 'resethwid') {
        const result = await callAPI('/keys/resethwid', { secret: process.env.API_SECRET || 'r3volt-secret-change-me', key });
        if (!result.success) return interaction.reply({ content: `❌ Clé introuvable : \`${key}\``, ephemeral: true });
        return interaction.reply({ content: `🔓 HWID **reset** pour : \`${key}\``, ephemeral: true });
      }

    } catch (err) {
      console.error('Erreur /menukeys:', err);
      return interaction.reply({ content: '❌ Erreur API.', ephemeral: true });
    }
  }

  // ── /key ───────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'key') {
    const hasDevRole = interaction.member.roles.cache.has(CONFIG.DEV_ROLE_ID);
    if (!hasDevRole) {
      return interaction.reply({ content: '❌ Commande réservée aux **Développeurs**.', ephemeral: true });
    }
    if (interaction.channelId !== CONFIG.KEY_CHANNEL_ID) {
      return interaction.reply({ content: `❌ Cette commande n'est utilisable que dans <#${CONFIG.KEY_CHANNEL_ID}>.`, ephemeral: true });
    }

    const product  = interaction.options.getString('produit');
    const duration = interaction.options.getString('duree');

    try {
      const result = await callAPI('/keys/create', {
        secret:   process.env.API_SECRET || 'r3volt-secret-change-me',
        product,
        duration,
        userId:   interaction.user.id,
        username: interaction.user.username,
      });

      if (!result.key) {
        return interaction.reply({ content: '❌ Erreur lors de la génération de la clé.', ephemeral: true });
      }

      const durationLabel = { '1day': '1 Jour', '1week': '1 Semaine', '1month': '1 Mois', 'lifetime': 'Lifetime' }[duration] || duration;
      const expiresText   = result.expiresAt
        ? `<t:${Math.floor(result.expiresAt / 1000)}:F>`
        : '♾️ Jamais';

      const keyEmbed = new EmbedBuilder()
        .setTitle('🔑  Clé générée')
        .setColor(0xe74c3c)
        .addFields(
          { name: '🔐 Clé',      value: `\`\`\`${result.key}\`\`\``, inline: false },
          { name: '📦 Produit',  value: product,       inline: true  },
          { name: '⏱️ Durée',   value: durationLabel,  inline: true  },
          { name: '📅 Expire',   value: expiresText,    inline: true  },
        )
        .setFooter({ text: 'R3VOLT • Key System' })
        .setTimestamp();

      // Envoie la clé en DM à l'utilisateur (privé) + confirmation ephemeral
      await interaction.reply({ embeds: [keyEmbed], ephemeral: true });

      // Log dans le salon /key
      const logEmbed = new EmbedBuilder()
        .setTitle('📋  Key Log')
        .setColor(0x2c2f33)
        .addFields(
          { name: 'Généré par', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Produit',    value: product,                      inline: true },
          { name: 'Durée',      value: durationLabel,                inline: true },
          { name: 'Expire',     value: expiresText,                  inline: true },
        )
        .setFooter({ text: result.key })
        .setTimestamp();

      await interaction.channel.send({ embeds: [logEmbed] });

    } catch (err) {
      console.error('Erreur /key:', err);
      return interaction.reply({ content: '❌ L\'API de clés est inaccessible. Lance `api.js` d\'abord.', ephemeral: true });
    }
  }

  // ── /setstatus ─────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'setstatus') {
    const hasDevRole = interaction.member.roles.cache.has(CONFIG.DEV_ROLE_ID);
    if (!hasDevRole) {
      return interaction.reply({ content: '❌ This command is reserved for **Developers** only.', ephemeral: true });
    }

    const productInput = interaction.options.getString('product');
    const newStatus    = interaction.options.getString('status');
    const guild        = interaction.guild;

    // Cherche dans la catégorie Products, en excluant le salon status
    // productInput = valeur brute du salon (ex: "gmod")
    const targetChannel = guild.channels.cache.find(
      c =>
        c.parentId === CONFIG.STATUS_CATEGORY_ID &&
        c.id !== CONFIG.STATUS_CHANNEL_ID &&
        c.name.toLowerCase() === productInput.toLowerCase()
    );

    if (!targetChannel) {
      return interaction.reply({
        content: `❌ Product \`${productInput}\` not found. Please re-run the bot to refresh product list.`,
        ephemeral: true,
      });
    }

    const oldStatus = productStatuses[targetChannel.id] || 'Undetected';
    productStatuses[targetChannel.id] = newStatus;
    saveStatuses(); // persist to disk

    await postStatusPanel(guild);

    // Annonce dans le salon News
    const newsChannel = await client.channels.fetch(CONFIG.NEWS_CHANNEL_ID).catch(() => null);
    if (newsChannel) {
      const newsColor = newStatus === 'Undetected' ? 0x2ecc71 : newStatus === 'Testing' ? 0xf1c40f : 0x3498db;
      const newsEmbed = new EmbedBuilder()
        .setTitle('🔄  Product Status Update')
        .setDescription(
          `**${formatChannelName(targetChannel.name)}**\n\n` +
          `${statusDot(oldStatus)} \`${oldStatus}\` **→** ${statusDot(newStatus)} \`${newStatus}\``
        )
        .addFields({
          name: '📝 Details',
          value: `${formatChannelName(targetChannel.name)} status changed from "${oldStatus}" to "${newStatus}"`,
        })
        .setColor(newsColor)
        .setFooter({ text: 'R3volt Status Update' })
        .setTimestamp();

      await newsChannel.send({ content: '@everyone', embeds: [newsEmbed] });
    }

    await interaction.reply({
      content: `✅ **${formatChannelName(targetChannel.name)}** status updated to \`${newStatus}\``,
      ephemeral: true,
    });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────
function closeRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('❌  Close Ticket')
      .setStyle(ButtonStyle.Danger),
  );
}

function statusDot(status) {
  switch (status) {
    case 'Undetected': return '🟢';
    case 'Updating':   return '🔵';
    case 'Testing':    return '🟡';
    default:           return '⚫';
  }
}

function formatChannelName(name) {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

client.login(process.env.TOKEN);
