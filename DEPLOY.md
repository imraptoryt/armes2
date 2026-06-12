# Déploiement — Vercel + Supabase

Synchronisation **temps réel** de l'état du terminal entre tous les visiteurs,
quel que soit leur PC.

Architecture :

```
Browser ──(supabase-js)──► Supabase (Postgres + Realtime)
   ▲                                │
   └──── Realtime subscription ◄────┘
```

Le front est servi en statique par Vercel. La synchro passe par Supabase
via la table `dhs_state` (une seule ligne, `room = 'default'`).

---

## 1) Créer le projet Supabase

1. Aller sur https://supabase.com → **New project**.
2. Une fois prêt : ouvrir **SQL Editor** → **New query**.
3. Coller le contenu de [`supabase-setup.sql`](supabase-setup.sql) → **Run**.
4. Vérifier dans **Database → Replication** que `dhs_state` est bien
   publiée sur `supabase_realtime` (le script le fait déjà).

## 2) Récupérer les clés

Dans **Project Settings → API** :

- `Project URL` → ça va dans `SUPABASE_URL`
- `anon public` key → ça va dans `SUPABASE_ANON`

> ⚠️ **Ne JAMAIS** coller la `service_role` key dans le HTML.
> L'`anon public` est faite pour être publique, RLS protège la table.

## 3) Coller les clés dans `index.html`

Ouvrir [`index.html`](index.html), chercher le bloc `=== SUPABASE ===` et
remplacer :

```js
const SUPABASE_URL  = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON = "YOUR-ANON-PUBLIC-KEY";
```

## 4) Déployer sur Vercel

### Option A — via l'interface

1. Pousser le repo sur GitHub.
2. https://vercel.com → **Add New… → Project** → importer le repo.
3. Framework Preset : **Other**. Pas de build command, pas d'output dir
   (site statique, `vercel.json` est déjà là).
4. **Deploy**.

### Option B — via le CLI

```bash
npm i -g vercel
vercel        # déploiement preview
vercel --prod # production
```

## 5) Tester la synchro

1. Ouvrir l'URL Vercel sur deux machines différentes (ou deux navigateurs
   différents).
2. Sur l'un : taper le code de la base centrale (`7714`), lancer un
   transfert, déployer le payload…
3. L'autre poste **reflète l'état en quelques centaines de ms** sans
   recharger la page.

L'indicateur `SYNC` (en bas à droite) reste vert tant que la subscription
Realtime est ouverte.

---

## Notes / dépannage

- **Rien ne se synchronise** : vérifier la console du navigateur. Les
  erreurs `[sync] ...` viennent du bridge Supabase. La cause la plus
  fréquente est une URL/clé mal collée ou la table `dhs_state` absente.
- **403 sur les writes** : RLS non activé correctement. Re-jouer
  `supabase-setup.sql`.
- **Realtime silencieux** : Database → Replication → cocher `dhs_state`.
- **Plusieurs scènes RP en parallèle** : changer la constante `ROOM_ID`
  côté front (ou la lire depuis `?room=` dans l'URL).
- **Reset de l'état** : dans le SQL Editor :
  ```sql
  update public.dhs_state set state = '{}'::jsonb where room = 'default';
  ```
