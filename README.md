# Pawsling

A slingshot game for Telegram (Mini App): cats and raccoons against an uprising of robot vacuums.

```
webapp/index.html   the whole game in one file (canvas + synthesised sounds, no assets)
bot/                a small bot that opens the game: /start and the "Грати" menu button
```

## Gameplay

- 12 levels in 3 rooms (Kitchen, Living room, Bedroom), each room ends with a boss.
- Stars: 3 for finishing within the par turn count, 2 for up to 1.5×par, 1 otherwise.
- Progress is saved in localStorage and, inside Telegram, in `CloudStorage`, so it syncs across devices.
- Inside Telegram: vibration (`HapticFeedback`), the system Back button, the player's name on the map.

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
   updates the game within a minute or two.
2. **Menu button "Грати".** `bot/bot.py` sets it via `setChatMenuButton`. **One run is enough**:
   Telegram remembers the button, and it stays after the bot is stopped. Rerun only if the game
   address changes.
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

With the bot stopped, `/start` gets no reply. That is expected: players go in through the menu
button or "Open App".

When server logic appears (friends leaderboards, daily quests, invites), the bot is worth
moving to webhooks on Cloudflare Workers (free, always on). Results should then be verified
there against Telegram `initData` so scores cannot be faked.
