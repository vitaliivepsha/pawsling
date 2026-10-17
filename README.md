# Pawsling

A slingshot game for Telegram (Mini App): cats and raccoons against an uprising of household robots and gadgets.

```
webapp/index.html   a tiny loader that fetches the game past Telegram's cache
webapp/game.js      the whole game (canvas + synthesised sounds, no assets)
webapp/game.css     page styles for the game
bot/                a small bot that opens the game: /start and the "Грати" menu button
worker/             the leaderboard: a Cloudflare Worker with a D1 database
```

## Gameplay

- 102 levels in 18 rooms, each room ends with a boss: Kitchen, Living room, Bedroom (4 levels each),
  Bathroom, Balcony, Attic, Garage, Basement, Roof, Garden, Server room, Stairwell, Warehouse, Factory, Lab, Space station, Polar station, Underwater base (6 levels each). The map scrolls.
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
- The factory (toughness ×5.8) has laser fences that switch on every other turn
  and bounce heroes like walls, and turrets that fire along their whole row, hitting every hero
  level with them (the row glows red the turn before). It ends with Assembler Prime: after each
  attack it rebuilds the last robot broken in the wave with half its health.
- The lab (toughness ×6.05) has acid pools: a hero standing in one after the
  robots' turn loses a heart (never the last). Tesla bots zap every hero within reach (the area
  glows red the turn before). It ends with Professor Flask: after each attack it spills a new acid
  pool under the hero it hit (three spills at most, the oldest dries up).
- The space station (toughness ×6.3) has meteor strikes: markers appear a turn
  ahead, and a meteor takes a heart from heroes inside (never the last) and a chunk of health from
  robots. Warp bots blink to a new spot after every shot that hits them. It ends with Commander
  Orbit: after each attack it marks meteors right on two heroes, landing two turns later.
- The polar station (toughness ×7.2) has a blizzard: wind blows across the room from
  a new side every turn (an arrow at the top shows it) and pushes flying heroes. Cryo bots freeze the
  hero they hit, who skips a turn unless a friend's shot breaks the ice. It ends with the Blizzard
  Snowplough: after each attack it sweeps every hero 110 px the way the wind blows.
- The underwater base (levels 97-102, toughness ×6.6 with harder mechanics, the hardest room): the water
  rises a mark every turn from the bottom (up to 35% of the field, starting low again each wave) and slows
  flying heroes inside it. Jelly bots charge up the turn before they attack; a hero that hits a charged
  one stops dead, even a piercer. It ends with Kraken Deep: after each attack the water jumps three marks.
  Level 102 is the finale: a gold medallion on the map and gold rays behind the kraken.
- Weekly challenge (from level 12, on the Daily screen's week tab): one level a week, the same for
  everyone, in a room from the balcony on with two modifiers from the newer rooms (blizzard, acid,
  meteors, laser fences, conveyor belts). Fewer turns wins; it has its own weekly board (`/chal`,
  board `chal`), no Second wind, and the first win of the week gives a heart.
- Weekly quests: the Daily screen has Today / This week tabs. Each week three quests (picked by the
  week, the same for everyone) from eight kinds: knots, robots, bosses, no-knockout wins, 3-star wins,
  a Night Shift run, friend combos, laser catches. Each gives a heart or a quick start, all three a
  free Second wind; the server pays each once (`/quest`).
- Robot album: the guide's Enemies tab counts wins over each robot (bosses as one card). 10, 50 and 200
  wins make a card bronze, silver and gold and give a quick start, a heart and a Second wind; the
  server pays each tier once (`/album`).
- Chest: a chest on the map's bottom bar ripens every 6 hours (a heart or a quick start, 10% a free
  Second wind). A chest that has waited 2+ hours for a player away 8+ hours gets one bot note a day
  (12:00-20:00 local, `startapp=chest` opens it).
- We miss you: a player away 3-30 days gets +1 heart and +1 quick start with a bot note, at most once
  a week (12:00-20:00 local).
- Friends: the board has a Friends tab (people you invited and whoever invited you, by stars, with
  their Night Shift best). When a player passes a friend in Night Shift or stars, the bot tells that
  friend (once a day at most) with a button that opens the Friends tab (`startapp=friends`).
- Streak reminder: in the evening (2-5 hours before the UTC day change, between 9:00 and 22:00 local
  time) the bot reminds players with a login streak of 5+ days who haven't opened the game today.
  Every 30 days in a row gives the party hat (or a free Second wind once they have it).
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
  exclusive hat. Progress is kept per event year, in the game. Inside Telegram each newly won level is
  also reported to the worker (`/event`, once per level; wins from before that are sent on the next
  launch), which keeps each player's furthest level per run in `event_runs` (`halloween-2026`; New Year
  is keyed by the year it starts) so the news channels can count who has the hat. In `#dev`,
  `window.__event = 'halloween'` forces one.
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
  Typing `@<bot>` in any chat offers the invite card, a record challenge and a text invite in the player's
  language; a word after the bot's name picks another one (`en`, `pl`, `de`, `es`, `uk`, or the language's name).
- **News channel gift**: a card on the Today tab of Daily, "Subscribe to the news — +1 heart". It opens
  the channel for the player's language (`CHANNEL_UK` for Ukrainian, `CHANNEL_EN` for everyone else),
  then Check calls `/subscribed`: the worker asks Telegram (`getChatMember`, the bot is an admin there)
  and gives the heart once per player (the `subs` table). The card is hidden once taken, outside
  Telegram, and when no channel is set (or it has no @username).
- **Weekly Night Shift tournament**: the Week tab of the leaderboard. A cron on Monday 00:05 UTC gives
  the top 3 boosters and a message from the bot.
- All of it is decided by the worker (`/daily`, `/challenge`, `/subscribed`, the `weekly` table), never by the page.

## News channels

The worker posts to a Ukrainian and an English Telegram channel (`CHANNEL_UK`, `CHANNEL_EN` in
`wrangler.toml`, the bot an admin there): the week's results and the new weekly challenge on Monday, a
tip or a room spotlight from `CH_FEED` on Tuesday, Thursday and Saturday, the challenge leader on Friday,
and seasonal events: the announcement on the first day, and three days before the end (2 Nov, 7 Jan,
15:00) a "3 days left" post with how many players already have the hat (from `event_runs`, left out
while under 10). A channel stays quiet until the owner's `/chan intro`. Play buttons carry
`startapp=ch_<lang>_<kind>`; every new player's first start_param goes to `sources`, and `/chan` shows
arrivals by source. Setup and the audience plan: `promo/CHANNELS.md`.

The community group (`COMMUNITY_GROUP`, a forum; the bot an admin with "Manage topics") gets its topics
from the owner's `/chan group`: 🇺🇦 UA, 🇬🇧 EN, 🛠 Technical Support and 📣 Events, the last closed to
members. The week's results and the event posts go to Events in both languages (`startapp=grp_…`),
and `/start` links the player's language topic next to the news channel. Once a channel reaches `CH_GROUP_AT`
(100) subscribers it gets one post inviting to the group, with buttons into its language topic and into
Technical Support (`/chan post group` posts it by hand).

## Leaderboard

`worker/` is a Cloudflare Worker (free plan) with a D1 database. The game posts Telegram's `initData`
with every request; the worker checks its signature with the bot token, so a result is always saved
for the real Telegram account. Scores are capped (500 waves, 400 stars); a determined player could
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
