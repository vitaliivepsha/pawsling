# Pawsling: store listing kit

Everything needed to list the game in Telegram's app catalog and in other catalogs.

## Links

- Bot: https://t.me/pawsling_game_bot
- Play (direct Mini App link): https://t.me/pawsling_game_bot?startapp
- Web page (has an Open Graph preview): https://vitaliivepsha.github.io/pawsling/webapp/
- Privacy Policy: https://vitaliivepsha.github.io/pawsling/webapp/privacy.html
- Terms of Use: https://vitaliivepsha.github.io/pawsling/webapp/terms.html
- Support: write to the bot; messages reach the developer (the owner answers by replying).

## Images

| File | Size | Use |
|---|---|---|
| `assets/bot-avatar.png` | 1024×1024 | bot avatar (@BotFather → /setuserpic): a paw in flight |
| `webapp/icon-512.png` | 512×512 | the same logo: site icon, catalog icon |
| `webapp/og.jpg` | 1200×630 | link preview of the web page (Open Graph) |
| `promo/en/*.jpg`, `promo/uk/*.jpg` | 1080×1920 | Mini App media previews and catalog screenshots, in order 1–6 |
| `promo/welcome-640x360.jpg` | 640×360 | @BotFather → Welcome message → Set Welcome Picture (empty chat); a 1280×720 copy is next to it |

## Texts

**Name:** Pawsling

**Tagline (EN, ≤ 30):** Slingshot cats vs robot vacuums
**Tagline (UK):** Коти з рогатки проти пилососів

**Short description (EN, ≤ 120):** Launch cats & raccoons like a slingshot and save the flat from robot vacuums! 66 levels, 12 bosses. Free to play.

**Short description (UK):** Запускай котів і єнотів, як з рогатки, і рятуй квартиру від роботів-пилососів! 66 рівнів, 12 босів. Безкоштовно.

**Description (EN):**
Pull back, aim and launch your heroes like a slingshot. Bounce off walls, pierce through robots, cross your yarn to tie exploding knots and beat 12 wild robot bosses across 66 levels, from the kitchen to the stairwell.
- 7 heroes with superpowers that level up
- Night Shift: endless waves and a weekly tournament with prizes
- Daily bonus, daily challenges and story comics
- 5 languages: English, Ukrainian, Polish, German, Spanish

**Опис (UK):**
Тягни, цілься й запускай героїв, як з рогатки. Відбивайся від стін, прошивай роботів наскрізь, перетинай нитки, щоб в'язати вибухові вузли, і перемагай 12 шалених босів у 66 рівнях, від кухні до під'їзду.
- 7 героїв із суперсилами, які прокачуються
- «Нічна зміна»: нескінченні хвилі й турнір тижня з призами
- Щоденний бонус, завдання дня й комікси
- 5 мов: українська, англійська, польська, німецька, іспанська

**Category:** Games (casual, arcade). **Price:** free, optional purchases in Telegram Stars. **Crypto:** none.

## Telegram's app catalog (the Apps tab in search)

Telegram picks apps for the catalog itself; these settings raise the chances:

1. @BotFather → your bot → **Bot Settings → Configure Mini App → Main App**: already on.
2. Same place → **Media previews**: upload `promo/en/1…6.jpg` for English, then add a Ukrainian set from `promo/uk/` for the Ukrainian language.
3. @BotFather → **/setuserpic**: upload `assets/bot-avatar.png`.
4. @BotFather → your bot → **Bot Settings → Privacy Policy** (if offered in your BotFather version): the Privacy Policy link above.
5. Descriptions in five languages are already set through the Bot API (they show in the bot's profile and in `t.me` link previews).
