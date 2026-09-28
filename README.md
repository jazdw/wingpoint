# WingPoint 🪽

A fast, installable web app for keeping score and tracking stats while playing
**Wingspan** and its expansions. Built for Cloudflare Workers + D1 with a React
front end, Google sign-in (allow-list only) and offline support.

## Features

- **Score sheet** matching the familiar Wingspan layout: Birds, Bonus cards,
  End-of-round goals, Eggs, Cached food, Tucked cards, plus Nectar (Oceania),
  Duet map (Asia) and the hummingbird track (Americas).
- **Per-round end-of-round goals**, green (majority, with the official point
  table and tie-splitting) or blue (one point per item, capped at 5).
- **Live totals** and automatic winner detection (🏆), broken on ties by unused
  food as per the rulebook.
- **Auto-save** — every change is saved shortly after you stop typing. While
  offline, edits are kept in `localStorage` and synced when you reconnect.
- **Live viewing** — linked players watch a game update live from their own
  login; only the score master (the game owner) can edit.
- **Stats across games** — wins, averages, category breakdowns, results by
  player count, and head-to-head records.
- **PWA** — installable on Android and iOS, with a service-worker app shell so
  the UI loads offline.
- **Google OAuth** with an email allow-list.

## Stack

| Layer    | Technology                                             |
| -------- | ------------------------------------------------------ |
| Frontend | React 19, Vite, TypeScript, React Router, TanStack Query |
| Backend  | Cloudflare Worker (TypeScript) with [Hono](https://hono.dev) |
| Database | Cloudflare D1 (SQLite)                                  |
| Auth     | Google OAuth 2.0, DB-backed sessions in HttpOnly cookies |
| PWA      | Hand-rolled service worker + web manifest              |

Scoring logic lives in [`shared/scoring.ts`](shared/scoring.ts) and is imported
by both the Worker and the browser, so displayed and stored totals always match.

## Getting started

```bash
npm install

# Create the D1 database (only once). Copy the printed database_id into
# wrangler.jsonc, or accept the placeholder for local-only development.
npm run db:create

# Apply migrations to the local D1 database
npm run db:migrate

# Configure local secrets
cp .dev.vars.example .dev.vars   # then edit it

npm run dev
```

The dev server runs at <http://localhost:5173>. The Worker API is served on the
same origin under `/api/*`.

> **Note:** Google OAuth requires an `http://localhost:5173/api/auth/google/callback`
> redirect URI to be registered for your OAuth client (see below).

### Useful scripts

| Script                   | Description                              |
| ------------------------ | ---------------------------------------- |
| `npm run dev`            | Start the Vite + Worker dev server       |
| `npm run build`          | Type-check and build for production      |
| `npm run preview`        | Build and preview locally                |
| `npm run typecheck`      | Type-check front end and Worker          |
| `npm run test:scoring`   | Run the scoring-engine self-tests        |
| `npm run lint`           | Run Oxlint                               |
| `npm run db:migrate`     | Apply migrations to local D1             |
| `npm run db:migrate:remote` | Apply migrations to production D1     |
| `npm run deploy`         | Build and deploy with Wrangler           |
| `npm run icons`          | Regenerate PWA PNG icons                 |

## Google OAuth setup

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   create an **OAuth client ID → Web application**.
2. Add authorised redirect URIs:
   - `http://localhost:5173/api/auth/google/callback` (development)
   - `https://<your-worker-domain>/api/auth/google/callback` (production)
3. Put the client id/secret in `.dev.vars` for local development, and set them
   as Worker secrets for production:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

### Allow-list

Only allow-listed emails can sign in. Configure them with either:

- the `ALLOWED_EMAILS` variable (comma separated), or
- the `allowed_emails` D1 table.

`ALLOWED_EMAILS` is defined in `wrangler.jsonc` for production and in
`.dev.vars` for local development. To add someone without redeploying:

```bash
npx wrangler d1 execute wingpoint --remote \
  --command "INSERT INTO allowed_emails (email, added_at, note) VALUES ('friend@example.com', $(date +%s000), 'invited');"
```

## Stats & sharing

- **Personal stats** are attributed to an account when a player row is linked to
  it (the New Game screen lets you link players to allow-listed users). A guest
  is tracked by name instead.
- **Other players’ stats**: on the Stats page you can pick any account you have
  played a game with. Someone you have never shared a game with is not listed and
  the API refuses to return their stats.
- **Head to head**: your Stats page shows results against everyone you have
  played with (linked accounts and named guests).
- **Visibility**: a game can only be seen by its owner and the linked players in
  it. There is no global/group browsing.
- **Invitations**: linking another account to a game sends them an invitation;
  the game shows as *Invitation* on their dashboard until they accept or decline.
  Guests never need to accept.
- **One in-progress game per user**: you can’t start or accept a game while you
  already have one in progress. Finish or delete it first.
- **Live viewing**: while a game is in progress, non-owners poll every 5 seconds
  and the score sheet is read-only for them.

## Deployment

### Option A — GitHub Actions (included)

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds, applies
D1 migrations and deploys on every push to `main`. Add these repository secrets:

| Secret                   | Where to get it                                              |
| ------------------------ | ------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`   | Cloudflare dashboard → My Profile → API Tokens (Workers + D1 edit) |
| `CLOUDFLARE_ACCOUNT_ID`  | Cloudflare dashboard → Workers & Pages → Account ID          |

### Option B — Cloudflare Workers Builds (dashboard Git integration)

Cloudflare can build and deploy straight from your Git provider without a
committed workflow. In **Workers & Pages → your Worker → Settings → Builds**,
connect the repository, set the build command to `npm run build`, the deploy
command to `npx wrangler deploy`, and add `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` as secrets. If you use this option you can delete
`.github/workflows/deploy.yml`.

### D1 for production

Before the first deploy, create the production database and set its id in
`wrangler.jsonc`:

```bash
npx wrangler d1 create wingpoint
# copy the database_id into wrangler.jsonc
npx wrangler d1 migrations apply wingpoint --remote
```

## Scoring & expansions

A game is configured from **standalone sets (Wingspan and/or Wingspan Asia) + a
goal board side (green/blue) + any combination of expansions**. The scoring
categories are derived from that configuration in `shared/scoring.ts`.

The Asia **Duet/Flock play modes** remain implemented in the scoring engine and
stored on each game (`play_mode`), but are intentionally not shown in the UI yet,
so they can be surfaced again later without a schema change.

Categories are added to every game as follows:

| Category | Added when |
| -------- | ---------- |
| Birds, Bonus cards, End-of-round goals, Eggs, Cached food, Tucked cards | always |
| Nectar | Oceania is in play (5 pts first, 2 pts second; ties split evenly) |
| Hummingbird track | Americas is in play (signed points) |
| Duet map | Wingspan Asia + Duet mode — engine only, not shown in the UI yet |

Invalid configurations (for example Flock without Asia, Duet with other than 2
players) are rejected with a message.

**Green end-of-round goals** are entered per round as a placement
(1st/2nd/3rd/none) and scored with the official table:

| Round | 1st | 2nd | 3rd |
| ----- | --- | --- | --- |
| 1     | 4   | 1   | 0   |
| 2     | 5   | 2   | 1   |
| 3     | 6   | 3   | 2   |
| 4     | 7   | 4   | 3   |

Ties combine the points for the places the tied players occupy, divide evenly and
round down (two players tied for 1st in round 1 each get 2).

**Blue end-of-round goals** are entered per round as the number of targeted items;
each scores one point, capped at 5 per round.

The official Oceania rule for a tied nectar majority is the same split. Asia
**Flock mode** instead uses friendly ties (both get the full points and second place
stays available). A tie for the highest overall score is broken by **unused food**,
exactly as in the rulebook — the score sheet includes an "Unused food" row for this.

Adding a new expansion means adding a category (or profile) in `shared/scoring.ts`
— no database migration is required because scores are stored as JSON. Known
expansion ids are validated in `worker/games.ts`.

### Roadmap

- Solo and Automa scoring helpers (Automa cards and difficulty levels).
- Bird/card database and per-bird stats.

## Project structure

```
shared/            Types and the scoring engine (used by Worker + frontend)
worker/            Cloudflare Worker API (Hono)
  auth.ts          Google OAuth, sessions, allow-list
  games.ts         Game CRUD + auto-save persistence
  stats.ts         Aggregate statistics
  users.ts         Allow-listed account list
migrations/        D1 migrations
src/               React app
  components/      Layout, score sheet, score input
  pages/           Login, Dashboard, NewGame, GameDetail, Stats
public/            Manifest, service worker, icons
scripts/           Icon generator
```

## Credits & licence

Private project. Wingspan is a trademark of Stonemaier Games; this app is an
unofficial companion and is not affiliated with or endorsed by them.

The UI uses **Cardenio Modern** by [Nils Cordes](https://nilscordes.com), licensed
under CC BY-SA 4.0. The font files and full licence text are in `public/fonts/`.
