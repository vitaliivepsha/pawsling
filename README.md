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

1. **Hosting.** A Mini App needs a public HTTPS address. The simplest option is GitHub Pages:
   put `webapp/index.html` into a repository and enable Pages. The address will look like
   `https://<user>.github.io/pawsling/`.
2. **Bot.** In @BotFather, run `/newbot` to get a token.
3. **Start the bot:**
   ```bash
   cd bot
   cp .env.example .env      # fill in BOT_TOKEN and WEBAPP_URL
   pip install -r requirements.txt
   python bot.py
   ```
   Or with Docker: `docker build -t pawsling-bot bot && docker run --env-file bot/.env pawsling-bot`.
4. Optional: in @BotFather → Bot Settings → Configure Mini App, set the same URL. The game will then
   open from the bot's profile and via the `t.me/<bot>?startapp` link.
