# Black Vulture — Bot Discord + Dashboard

Deux morceaux :

1. **`bot.js`** — bot Discord qui compte les messages d'un channel, enregistre
   les mouvements de stock dans Supabase, et poste un **résumé embed chaque
   nuit à minuit** (heure de Paris) via webhook.
2. **`../index.html`** — dashboard web (thème noir & orange) qui affiche tous
   les stocks par stockage/catégorie, en temps réel.

```
Discord channel ──► bot.js ──► Supabase (bv_items / bv_transactions / bv_daily)
                       │                         ▲
                       │ minuit (cron)           │ realtime
                       ▼                         │
                Webhook résumé            index.html (dashboard)
```

---

## 1) Base de données

Dans Supabase → SQL Editor → coller [`../blackvulture-setup.sql`](../blackvulture-setup.sql) → Run.
(Même projet que `dhs_state`, ça cohabite.)

## 2) Créer le bot Discord

1. https://discord.com/developers/applications → **New Application** → nomme-la `Black Vulture`.
2. Onglet **Bot** → **Reset Token** → copie le token.
3. Toujours dans **Bot**, active **MESSAGE CONTENT INTENT** (obligatoire pour lire les messages).
4. Onglet **OAuth2 → URL Generator** : coche `bot`, puis les permissions
   `Read Messages/View Channels`, `Send Messages`, `Read Message History`,
   `Add Reactions`. Ouvre l'URL générée → invite le bot sur ton serveur.

## 3) Récupérer l'ID du channel de logs

Dans Discord : **Paramètres → Avancés → Mode développeur** (ON).
Puis clic droit sur ton channel de logs → **Copier l'identifiant**.

## 4) Remplir la config

Ouvre [`bot.js`](bot.js), en haut, bloc `CONFIG` :

```js
DISCORD_TOKEN: "COLLE_TON_TOKEN_DE_BOT_ICI",          // étape 2
LOG_CHANNEL_IDS: ["COLLE_L_ID_DU_CHANNEL_DE_LOGS"],   // étape 3
```

Le webhook du résumé, l'URL/clé Supabase et le logo sont déjà remplis.

> ⚠️ Le `DISCORD_TOKEN` est **secret** — ne le commit jamais sur GitHub public.
> Garde `bot.js` en local, ou mets le token dans une variable d'environnement.

## 5) Lancer

```bash
cd bot
npm install
node bot.js
```

Tu dois voir `[bot] connecté en tant que Black Vulture#1234`.

## 6) Tester

Dans le channel de logs, écris (format manuel) :

```
+5 ak-47 coffre1
+200 9mm coffre1
-2 lockpick garage
```

Le bot réagit ✅, le dashboard se met à jour en direct.
Commandes utiles dans le channel :

- `!stock` → le bot répond avec l'inventaire actuel
- `!rapport` → force l'envoi du résumé du jour (sans attendre minuit)

---

## Format des logs automatiques

`parseManual()` gère le format `+5 item stockage`. Pour les **logs automatiques**
de ton script FiveM (souvent des embeds), `parseAutoLog()` est un squelette à
adapter : envoie un screenshot d'un message de log réel et on cale le parseur
sur le format exact (titre / description / champs de l'embed).

## Garder le bot en ligne 24/7

`node bot.js` s'arrête si tu fermes le terminal. Options :

- **PM2** (simple) : `npm i -g pm2 && pm2 start bot.js --name black-vulture && pm2 save`
- **Un petit VPS** (Oracle Free, Raspberry Pi…) ou un hébergeur Node (Railway, Render).
- Le cron de minuit ne tourne que si le bot est **allumé** à minuit.
