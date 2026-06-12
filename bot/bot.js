/* =========================================================================
   BLACK VULTURE — Bot Discord de suivi des stocks
   - Compte les messages du channel de logs
   - Parse les mouvements de stock et les enregistre dans Supabase
   - Chaque nuit à minuit (heure de Paris) : résumé embed via webhook
   Lancement :  npm install  puis  node bot.js
   ========================================================================= */

const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const { createClient } = require("@supabase/supabase-js");
const cron = require("node-cron");

/* ====== CONFIG — remplis les 2 premières valeurs ====== */
const CONFIG = {
  DISCORD_TOKEN: "COLLE_TON_TOKEN_DE_BOT_ICI",          // ← Discord Developer Portal → Bot → Token
  LOG_CHANNEL_IDS: ["COLLE_L_ID_DU_CHANNEL_DE_LOGS"],   // ← clic droit sur le channel → Copier l'identifiant
  SUMMARY_WEBHOOK:
    "https://discord.com/api/webhooks/1515130017938669760/cM83OSp50JRtmBMDrYvi5YHQNHzZFgKJXQ91hgEMAw7JDPGlp7TIavZqr7nkoPDLBkde",
  SUPABASE_URL: "https://fgzmbkomdbggfqforxzn.supabase.co",
  SUPABASE_KEY: "sb_publishable_Y8LbGUHwi7PSnXhhOCLE4Q_9iu3WgVk",
  TIMEZONE: "Europe/Paris",
  LOGO: "https://imgg.fr/r/94agnuhj.png",
  COLOR: 0xff7a00, // orange Black Vulture
};

/* ====== CATÉGORIES (auto-classement par mots-clés) ====== */
const CATEGORIES = {
  Armes: ["ak", "m4", "pistol", "pistolet", "glock", "uzi", "smg", "fusil", "sniper", "carbine", "deagle", "revolver", "mp5", "shotgun", "pompe", "tec", "draco", "beretta", "colt"],
  Munitions: ["munition", "ammo", "balle", "chargeur", "cartouche", "9mm", "5.56", "7.62", "12g", ".45"],
  Équipement: ["gilet", "armure", "kevlar", "radio", "lockpick", "kit", "trousse", "medkit", "bandage", "masque", "gant", "sac", "cagoule", "crochetage"],
  Drogues: ["weed", "coke", "cocaine", "cocaïne", "meth", "crack", "heroine", "héroïne", "lsd", "pochon", "beuh", "ecstasy", "md"],
  Argent: ["argent", "cash", "billet", "sale", "propre", "liasse"],
};
function categorize(item) {
  const low = item.toLowerCase();
  for (const [cat, kws] of Object.entries(CATEGORIES)) if (kws.some((k) => low.includes(k))) return cat;
  return "Divers";
}

/* ====== HELPERS ====== */
const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function parisDay(d = new Date()) {
  // 'YYYY-MM-DD' en heure de Paris
  return new Intl.DateTimeFormat("fr-CA", { timeZone: CONFIG.TIMEZONE }).format(d);
}
function parisDateLabel(dayStr) {
  const [y, m, d] = dayStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

/* =========================================================================
   PARSEUR DES MOUVEMENTS
   Format manuel (marche tout de suite) :
       +5 ak-47 coffre1        → ajoute 5 ak-47 dans coffre1
       -2 lockpick garage      → retire 2 lockpick de garage
   (quantité, nom d'item (plusieurs mots ok), dernier mot = stockage)

   ⚠ FORMAT AUTO : parseAutoLog() ci-dessous est un SQUELETTE.
   Envoie le screenshot du message de log automatique et je l'adapte
   pour parser exactement ce que ton script FiveM poste dans le channel.
   ========================================================================= */
function parseManual(content) {
  const m = content.trim().match(/^([+-])\s*(\d+)\s+(.+?)\s+(\S+)$/);
  if (!m) return null;
  const delta = (m[1] === "-" ? -1 : 1) * parseInt(m[2], 10);
  return [{ storage: norm(m[4]), item: norm(m[3]), delta }];
}

/* Format auto réel (embed du script FiveM) :
     Titre  = nom du stockage          ex: "Coffre"
     Champs : Initiator | ID | Item | Amount | Type
     Type   = "Deposit" (+) ou "Withdraw"/"Remove"/"Take" (-)            */
function fieldVal(fields, ...names) {
  if (!fields) return null;
  const f = fields.find((fl) => names.some((n) => fl.name?.trim().toLowerCase() === n.toLowerCase()));
  return f ? f.value?.trim() : null;
}
function parseAutoLog(message) {
  const e = message.embeds?.[0];
  if (!e || !e.fields?.length) return null;

  const item = fieldVal(e.fields, "Item", "Items", "Objet");
  const amountRaw = fieldVal(e.fields, "Amount", "Quantity", "Quantité", "Qty");
  const type = (fieldVal(e.fields, "Type", "Action") || "").toLowerCase();
  // le stockage est le titre de l'embed ; sinon un champ Storage/Stash/Coffre
  const storage = e.title?.trim() || fieldVal(e.fields, "Storage", "Stash", "Coffre", "Inventory");
  if (!item || !amountRaw || !storage) return null;

  const amount = parseInt(String(amountRaw).replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(amount) || amount === 0) return null;

  // retrait = négatif
  const isWithdraw = /(withdraw|remove|take|retrait|sortie|out|prendre)/.test(type);
  const sign = isWithdraw ? -1 : 1; // par défaut (Deposit / Add / etc.) = positif

  const author = fieldVal(e.fields, "Initiator", "Player", "Joueur", "Auteur") || "auto";
  return [{ storage: norm(storage), item: norm(item), delta: sign * amount, author }];
}

/* ====== ÉCRITURE EN BASE ====== */
async function applyMove({ storage, item, delta }, author, raw) {
  const { data } = await sb.from("bv_items").select("qty").eq("storage", storage).eq("item", item).maybeSingle();
  const newQty = Math.max(0, (data?.qty ?? 0) + delta);
  await sb.from("bv_items").upsert(
    { storage, item, category: categorize(item), qty: newQty, updated_at: new Date().toISOString() },
    { onConflict: "storage,item" }
  );
  await sb.from("bv_transactions").insert({ day: parisDay(), storage, item, delta, author, raw: raw?.slice(0, 500) });
  return newQty;
}

async function bumpMessageCount() {
  const day = parisDay();
  const { data } = await sb.from("bv_daily").select("messages").eq("day", day).maybeSingle();
  await sb.from("bv_daily").upsert({ day, messages: (data?.messages ?? 0) + 1 });
}

/* ====== RÉSUMÉ DE MINUIT ====== */
async function postDailySummary(forDay) {
  // À minuit on résume la journée qui vient de se terminer
  const day = forDay || parisDay(new Date(Date.now() - 60 * 1000));

  const [{ data: items }, { data: txs }, { data: daily }] = await Promise.all([
    sb.from("bv_items").select("*").gt("qty", 0).order("storage").order("item"),
    sb.from("bv_transactions").select("*").eq("day", day),
    sb.from("bv_daily").select("messages").eq("day", day).maybeSingle(),
  ]);

  const msgCount = daily?.messages ?? 0;
  const txList = txs || [];

  // Agrégat des changements du jour : par stockage+item, somme des deltas
  const changes = {};
  for (const t of txList) {
    const key = t.storage + "‖" + t.item;
    changes[key] = (changes[key] || 0) + t.delta;
  }

  // ---- Embed 1 : entête + stats ----
  const head = new EmbedBuilder()
    .setTitle(`🦅 BLACK VULTURE — Rapport du ${parisDateLabel(day)}`)
    .setColor(CONFIG.COLOR)
    .setThumbnail(CONFIG.LOGO)
    .setDescription(
      `**${msgCount}** messages dans le channel · **${txList.length}** mouvements de stock`
    )
    .setTimestamp(new Date())
    .setFooter({ text: "Black Vulture · rapport automatique de minuit", iconURL: CONFIG.LOGO });

  // ---- Embed 2 : état des stockages ----
  const byStorage = {};
  for (const it of items || []) (byStorage[it.storage] = byStorage[it.storage] || []).push(it);

  const stockEmbeds = [];
  let cur = new EmbedBuilder().setTitle("📦 État des stockages").setColor(CONFIG.COLOR);
  let fieldCount = 0;
  for (const [storage, list] of Object.entries(byStorage)) {
    const lines = list.map((it) => `• ${cap(it.item)} — **${it.qty}**`).join("\n").slice(0, 1024) || "_vide_";
    if (fieldCount === 25) {
      stockEmbeds.push(cur);
      cur = new EmbedBuilder().setColor(CONFIG.COLOR);
      fieldCount = 0;
    }
    cur.addFields({ name: `📦 ${cap(storage)}`, value: lines, inline: true });
    fieldCount++;
  }
  if (fieldCount > 0) stockEmbeds.push(cur);
  if (!Object.keys(byStorage).length)
    stockEmbeds.push(new EmbedBuilder().setTitle("📦 État des stockages").setColor(CONFIG.COLOR).setDescription("_Aucun stock enregistré._"));

  // ---- Embed 3 : changements du jour ----
  const changeLines = Object.entries(changes)
    .filter(([, d]) => d !== 0)
    .map(([key, d]) => {
      const [storage, item] = key.split("‖");
      return `${d > 0 ? "🟢 +" : "🔴 "}${d} ${cap(item)} *(${storage})*`;
    });
  const changesEmbed = new EmbedBuilder()
    .setTitle(`📈 Changements du ${day}`)
    .setColor(CONFIG.COLOR)
    .setDescription(changeLines.length ? changeLines.join("\n").slice(0, 4000) : "_Aucun mouvement aujourd'hui._");

  // ---- Envoi via webhook (max 10 embeds par message) ----
  const allEmbeds = [head, ...stockEmbeds, changesEmbed].map((e) => e.toJSON());
  for (let i = 0; i < allEmbeds.length; i += 10) {
    await fetch(CONFIG.SUMMARY_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Black Vulture",
        avatar_url: CONFIG.LOGO,
        embeds: allEmbeds.slice(i, i + 10),
      }),
    });
    await new Promise((r) => setTimeout(r, 800));
  }
  console.log(`[summary] rapport du ${day} envoyé (${txList.length} mouvements, ${msgCount} messages)`);
}

/* ====== COMMANDES RAPIDES ====== */
async function cmdStock(message) {
  const { data: items } = await sb.from("bv_items").select("*").gt("qty", 0).order("storage").order("item");
  const byStorage = {};
  for (const it of items || []) (byStorage[it.storage] = byStorage[it.storage] || []).push(it);
  const e = new EmbedBuilder()
    .setTitle("🦅 Stocks actuels")
    .setColor(CONFIG.COLOR)
    .setThumbnail(CONFIG.LOGO)
    .setTimestamp(new Date());
  const entries = Object.entries(byStorage);
  if (!entries.length) e.setDescription("_Aucun stock enregistré._");
  for (const [storage, list] of entries.slice(0, 25))
    e.addFields({ name: `📦 ${cap(storage)}`, value: list.map((i) => `• ${cap(i.item)} — **${i.qty}**`).join("\n").slice(0, 1024), inline: true });
  await message.reply({ embeds: [e] });
}

/* ====== DISCORD CLIENT ====== */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on("ready", () => {
  console.log(`[bot] connecté en tant que ${client.user.tag}`);
  console.log(`[bot] résumé quotidien programmé à 00:00 (${CONFIG.TIMEZONE})`);
});

client.on("messageCreate", async (message) => {
  try {
    if (message.author.id === client.user.id) return;            // ignore soi-même
    if (!CONFIG.LOG_CHANNEL_IDS.includes(message.channel.id)) return;

    await bumpMessageCount();                                     // compte TOUS les messages du channel

    // commandes
    if (message.content.trim().toLowerCase() === "!stock") return cmdStock(message);
    if (message.content.trim().toLowerCase() === "!rapport") return postDailySummary(parisDay());

    // mouvements de stock : manuel d'abord, sinon logs auto (embed)
    const moves = parseManual(message.content) || parseAutoLog(message);
    if (!moves) return;

    for (const mv of moves) {
      const author = mv.author || message.author?.username || "auto";
      await applyMove(mv, author, message.content || JSON.stringify(message.embeds?.[0]?.fields || ""));
    }
    if (!message.author.bot) await message.react("✅").catch(() => {});
    console.log(`[stock] ${moves.map((m) => `${m.delta > 0 ? "+" : ""}${m.delta} ${m.item} (${m.storage})`).join(", ")}`);
  } catch (e) {
    console.error("[bot] erreur messageCreate:", e);
  }
});

/* minuit, heure de Paris */
cron.schedule("0 0 * * *", () => postDailySummary().catch(console.error), { timezone: CONFIG.TIMEZONE });

if (CONFIG.DISCORD_TOKEN.includes("COLLE_TON_TOKEN")) {
  console.error("⚠  Remplis CONFIG.DISCORD_TOKEN dans bot.js avant de lancer !");
  process.exit(1);
}
client.login(CONFIG.DISCORD_TOKEN);
