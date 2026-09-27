# Pawsling

A slingshot game for Telegram (Mini App): cats and raccoons against an uprising of robot vacuums.

```
webapp/index.html   a tiny loader that fetches the game past Telegram's cache
webapp/game.js      the whole game (canvas + synthesised sounds, no assets)
webapp/game.css     page styles for the game
bot/                a small bot that opens the game: /start and the "Грати" menu button
worker/             the leaderboard: a Cloudflare Worker with a D1 database
```

## Gameplay

- 36 levels in 7 rooms, each room ends with a boss: Kitchen, Living room, Bedroom (4 levels each),
  Bathroom, Balcony, Attic, Garage (6 levels each). The map scrolls.
- Later rooms bring new enemies: a toothbrush heals enemies nearby, a fan blows heroes off course,
  an RC car drives to a new spot every turn; in the garage a shield bot cuts damage to its neighbors
  to 35% and twins split into two minis when destroyed.
- Each room is tougher than the last (enemy toughness ×1 in the kitchen up to ×2.7 in the garage).
- Stars: 3 for finishing within the par turn count, 2 for up to 1.5×par, 1 otherwise.
- Night Shift (unlocks after level 4): endless generated waves, a boss every 5th wave, the room changes
  every 5 waves; the record is the number of waves survived.
- Heroes have hearts (Bandit 4, the others 3). A hero at 0 hearts is knocked out for 2 turns; an ally
  touching them with a shot revives them. Enemies hit the closest standing hero.
- Progress is saved in localStorage and, inside Telegram, in `CloudStorage`, so it syncs across devices.
- Inside Telegram: vibration (`HapticFeedback`), the system Back button, the player's name on the map.
- Languages: Ukrainian, English, Polish, German, Spanish. The player's choice (the button in the map's
  corner) wins, then Telegram's `language_code`, then the browser; anything else gets English.
  All text lives in the `I18N` dictionary in `game.js`.
- Leaderboard (the cup on the map): best Night Shift and total stars, inside Telegram only.

## Local testing

```bash
python -m http.server 5391 --directory webapp
```

Open http://localhost:5391. The `#dev` hash (http://localhost:5391/#dev) runs the loop on a timer
and exposes `window.__pawsling` for automated checks.

## Launching in Telegram

The game runs without a permanently running server: the page is on GitHub Pages
(https://vitaliivepsha.github.io/pawsling/webapp/), and everything else is configured in Telegram.

1. **Hosting.** GitHub Pages from the `main` branch, `/ (root)` folder. Every push to `main`
   updates the game within a minute or two. Telegram's WebView caches pages hard, so
   `index.html` only loads `game.js` and `game.css` with a fresh `?v=` on every launch: players
   get the new version as soon as Pages has it. Keep game changes in those two files; if
   `index.html` itself ever changes, bump the `?v=` in the game address (step 2 and @BotFather).
2. **Menu button "Грати".** `bot/bot.py` is a one-time script that sets it via `setChatMenuButton`
   and exits; Telegram remembers the button. Rerun only if the game address changes. The bot's
   messages (/start, payments) are handled by the worker's webhook, so never run a polling bot
   for this token: polling removes the webhook. The current address is `https://vitaliivepsha.github.io/pawsling/webapp/?v=2`.
   ```bash
   cd bot
   cp .env.example .env      # fill in BOT_TOKEN and WEBAPP_URL
   pip install -r requirements.txt
   python bot.py             # wait for "Menu button set", then Ctrl+C
   ```
3. **@BotFather** (one time):
   - Bot Settings → Configure Mini App → Enable Mini App, with the same URL. The "Open App" button
     then appears in the bot's profile, and the game opens via `t.me/<bot>?startapp`.
   - Edit Bot → Edit Description: the greeting shown before pressing Start.
   - Edit Bot → Edit About: a short description in the profile.
   - `/setuserpic`: the bot's profile picture, `assets/bot-avatar.png` (1024×1024, drawn with the
     game's own hero code; Telegram crops it to a circle, the yarn ring sits just inside it).


## Server: leaderboard, payments, bot replies

- `POST /board`: the leaderboard (see below).
- `POST /invoice`: a Telegram Stars invoice for an in-game item. Today there is one item,
  **Second wind** (10 Stars, `ITEMS.continue`): after a loss the player continues the level with
  full home strength and every hero back up, once per run. The price lives in `ITEMS` in
  `worker/src/index.js` and `WIND_PRICE` in `game.js`; keep them equal.
- `POST /tg`: the bot's webhook, registered automatically on the first game request. It approves
  pre-checkout queries (Telegram cancels a payment that is not approved within 10 seconds),
  records paid purchases in the `purchases` table and answers /start in the player's language.
  Stars earned go to the bot's balance (withdrawal via Fragment, see @BotFather → Payments).

## Leaderboard

`worker/` is a Cloudflare Worker (free plan) with a D1 database. The game posts Telegram's `initData`
with every request; the worker checks its signature with the bot token, so a result is always saved
for the real Telegram account. Scores are capped (500 waves, 90 stars); a determined player could
still send a fake result from their own account, which is the usual limit of a client-side game.

Setup (Node 18+; with nvm: `nvm use 22`):

```bash
cd worker
npx wrangler login                                   # opens the browser, once
npx wrangler d1 create pawsling                      # put the printed database_id into wrangler.toml
npx wrangler d1 execute pawsling --remote --file=schema.sql
npx wrangler deploy                                  # prints https://pawsling-leaderboard.<account>.workers.dev
npx wrangler secret put BOT_TOKEN                    # paste the bot token when asked
```

Then set `BOARD_URL` at the top of the leaderboard section in `webapp/game.js` to that address and push.
