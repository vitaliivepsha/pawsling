"""Pawsling launcher bot: opens the game Mini App from /start and the chat menu button."""
import logging
import os

from dotenv import load_dotenv
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, MenuButtonWebApp, Update, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes

load_dotenv()
BOT_TOKEN = os.environ["BOT_TOKEN"]
WEBAPP_URL = os.environ["WEBAPP_URL"]

logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=logging.INFO)
log = logging.getLogger("pawsling")


def play_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[InlineKeyboardButton("🐾 Грати", web_app=WebAppInfo(url=WEBAPP_URL))]])


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    name = update.effective_user.first_name if update.effective_user else ""
    await update.message.reply_text(
        f"Привіт, {name}! Роботи-пилососи захопили квартиру.\n"
        "Запускай котів і єнотів, як з рогатки, і відбий кухню, вітальню та спальню.",
        reply_markup=play_keyboard(),
    )


async def post_init(app: Application) -> None:
    await app.bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Грати", web_app=WebAppInfo(url=WEBAPP_URL)))
    log.info("Menu button set to %s", WEBAPP_URL)


def main() -> None:
    app = Application.builder().token(BOT_TOKEN).post_init(post_init).build()
    app.add_handler(CommandHandler(["start", "play"], start))
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
