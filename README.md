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

- 78 levels in 14 rooms, each room ends with a boss: Kitchen, Living room, Bedroom (4 levels each),
  Bathroom, Balcony, Attic, Garage, Basement, Roof, Garden, Server room, Stairwell, Warehouse, Factory (6 levels each). The map scrolls.
- The basement mixes every enemy type (toughness ×3.39) and ends with the Web-Spinner: after each
  attack it webs the hero it hit, who skips their next turn unless an ally frees them with a shot.
- The roof (toughness ×4.06) adds magnets that pull heroes in and bend their shots, and ends with
  the Thunder Drone: its strike jumps as chain lightning to the closest hero within reach, who
  loses a heart too, so it pays to keep the team spread out.
- The garden (toughness ×4.33) adds moles that dig underground every other turn, when shots roll
  right over them, and ends with the Swift Mower: after each attack it charges at the hero it hit
  and shoves aside anyone in its way.
- The server room (toughness ×4.68) adds 3D printers that print a mini robot after every attack (two
  at most), and ends with the Smart Home Hub: after each attack it overclocks every other robot, so
  their attacks come a turn sooner.
- The stairwell (toughness ×5.1) adds bomb bots that explode when destroyed,
  hurting robots nearby (chains are possible) and taking a heart from heroes nearby (never the last),
  and ends with the Express Lift: after each attack it strikes down its shaft, and every hero below it
  loses a heart; the shaft glows red the turn before.
- The warehouse (toughness ×5.67) has conveyor belts that push flying heroes
  sideways and box bots that hide in a box (the first hit only tears the box off; they box up again
  after attacking). It ends with the Mega Sorter: after each attack it reverses every belt and
  speeds it up.
- The factory (toughness ×5.8, the hardest room) has laser fences that switch on every other turn
  and bounce heroes like walls, and turrets that fire along their whole row, hitting every hero
  level with them (the row glows red the turn before). It ends with Assembler Prime: after each
  attack it rebuilds the last robot broken in the wave with half its health.
- Raids bring players back: raid alerts are on for every player by default; the bell on the Daily
  screen turns them off. After the first level the game asks Telegram once for permission to message
  players who never wrote to the bot; a player who blocks the bot is skipped until they start it again.
  On most days (each hour from 10:00 to 20:00 the player's time has a 12% chance, at most one a day,
  and only if they haven't played for 2 hours) the bot sends a poster of the raided room (`promo/raid/raid-<room>.jpg`) and a button.
  The raid is two waves of that room's robots; repelling it within 30 minutes gives +1 heart and
  +1 quick start, credited by the server. A red card with a countdown shows on the map meanwhile.
  The owner can send themselves one with `/raidtest`; `/raidlog` shows the last hourly runs. Players who block the bot are skipped.
- Knots are easy to read: while aiming, the preview marks where the shot will tie knots and which
  kind (colour), and an exploded knot stays on the floor as a little tied bow for a moment.
- Later rooms bring new enemies: a toothbrush heals enemies nearby, a fan blows heroes off course,
  an RC car drives to a new spot every turn; in the garage a shield bot cuts damage to its neighbors
  to 35% and twins split into two minis when destroyed.
- Each room is tougher than the last (enemy toughness ×1 in the kitchen up to ×5.15 in the warehouse).
- Stars: 3 for finishing within the par turn count, 2 for up to 1.5×par, 1 otherwise.
- Guide (the ? button on the map and in a level): Basics, Knots (rules, golden and two-hero knots)
  and Enemies (every robot, unknown ones hidden until met). The first time a robot type shows up in a
  run, a “New enemy” card explains it (kept in progress as `seen`).
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
   - `/setuserpic`: the bot's profile picture, `assets/bot-avatar.png` (1024×1024) or
     `webapp/icon-512.png`: a paw in flight with speed lines (paw + sling) on a warm gradient,
     chosen to stay readable as a tiny circle in the chat list on dark and light themes.


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

## Content

- **More heroes**: Rex the rescue dog (shop, 150 Stars, shown as a discount from 250; heals every ally he touches) and Hammy the
  hamster (free after level 24; the further he rolls, the harder he hits). A team is 4-5 heroes,
  picked on the Heroes screen.
- **Seasonal events**: Halloween (15 Oct - 5 Nov) and New Year (15 Dec - 10 Jan). An event card sits
  on top of the map while it runs; three levels with costumed enemies, and finishing them gives an
  exclusive hat. Progress is kept per event year. In `#dev`, `window.__event = 'halloween'` forces one.
- **Story**: a two-panel comic before the first level of each room and a finale after level 42,
  shown once each (`PROG.story`), all in five languages.

## Depth

- **Hero levels** (the paw button on the map): heroes earn XP for every win (more for more stars,
  double in challenge mode) and for Night Shift waves; up to level 10, +4% damage per level and an
  ability upgrade at levels 5 and 10. XP is part of the saved progress.
- **Combo knots**: a knot tied across two different heroes' threads is special: cat + raccoon is a
  fire knot (x1.5 damage), two cats a purring knot (wider), two raccoons a trash knot (also delays
  enemy attacks by a turn).
- **Challenge mode**: a won level can be replayed with enemies 40% tougher and a turn limit equal to
  its 3-star par; winning gives double XP and a crown on the map node.

## Daily and social

- **Daily** (button on the map): a login bonus with a 7-day streak (boosters, a party hat on day 7),
  the challenge of the day (a level plus a condition such as "tie 4 knots" or "no knockouts",
  rewarded once a day) and invites.
- **Invites**: the share link is `t.me/<bot>?startapp=ref_<id>`. A brand-new player who opens it
  gets +1 heart and +1 quick start, so does the inviter, and the bot messages the inviter. This needs
  the bot's Main Mini App set up in @BotFather (Bot Settings → Configure Mini App).
- **Weekly Night Shift tournament**: the Week tab of the leaderboard. A cron on Monday 00:05 UTC gives
  the top 3 boosters and a message from the bot.
- All of it is decided by the worker (`/daily`, `/challenge`, the `weekly` table), never by the page.

## Leaderboard

`worker/` is a Cloudflare Worker (free plan) with a D1 database. The game posts Telegram's `initData`
with every request; the worker checks its signature with the bot token, so a result is always saved
for the real Telegram account. Scores are capped (500 waves, 300 stars); a determined player could
still send a fake result from their own account, which is the usual limit of a client-side game.

Setup (Node 18+; with nvm: `nvm use 22`):

```bash
cd worker
npx wrangler login                                   # opens the browser, once
npx wrangler d1 create pawsling                      # put the printed database_id into wrangler.toml
npx wrangler d1 execute pawsling --remote --file=schema.sql
npx wrangler deploy                                  # prints https://pawsling-leaderboard.<account>.workers.dev
npx wrangler secret put BOT_TOKEN                    # paste the bot token when asked
npx wrangler secret put ADMIN_ID                     # optional: your Telegram id, for sales messages
```

With `ADMIN_ID` set, the bot messages the owner about every purchase and refund (a refund also
takes back what the purchase gave), and answers the owner's `/sales` with sales for the last day,
week, month and all time, the best sellers and the latest purchases. Refunded purchases are not
counted. Other players get no answer to `/sales`.

Then set `BOARD_URL` at the top of the leaderboard section in `webapp/game.js` to that address and push.
