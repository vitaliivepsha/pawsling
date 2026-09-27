"""One-time setup for the Pawsling bot: sets the "Грати" menu button that opens the game.

The bot itself runs on the Cloudflare Worker in ../worker (a webhook): it answers /start and
handles Telegram Stars payments. Do not run a polling bot for this token, because polling
removes the webhook and payments would stop working.
"""
import asyncio
import logging
import os

from dotenv import load_dotenv
from telegram import Bot, MenuButtonWebApp, WebAppInfo

load_dotenv()
BOT_TOKEN = os.environ["BOT_TOKEN"]
WEBAPP_URL = os.environ["WEBAPP_URL"]

logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)  # its request logs include the bot token in the URL
log = logging.getLogger("pawsling")


async def main() -> None:
    async with Bot(BOT_TOKEN) as bot:
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Грати", web_app=WebAppInfo(url=WEBAPP_URL)))
    log.info("Menu button set to %s", WEBAPP_URL)


if __name__ == "__main__":
    asyncio.run(main())
