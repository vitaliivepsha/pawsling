// Pawsling server: a Cloudflare Worker over a D1 database.
// Game requests carry Telegram's initData. Its signature is checked with the bot token,
// so everything is tied to the Telegram account that is actually playing.
//
// POST /board    { initData, night?, stars?, board? }
//   saves the player's best Night Shift waves and total stars (only ever raised),
//   and when `board` is "night" or "stars" returns the top of that board and the player's rank.
// POST /invoice  { initData, item, lang }  ->  { link }
//   a Telegram Stars invoice for an in-game item, opened in the game with WebApp.openInvoice.
// POST /inventory { initData }  ->  { items }   what the player owns (boosters, hats, heroes)
// POST /use       { initData, item }  ->  { ok, items }   spends one booster
// POST /daily     { initData }  ->  today's login bonus (once a day), streak, invite count, bot name;
//   a first visit through a friend's link (start_param ref_<id>) gifts both players
//   (also the news channel for the player's language and whether its subscription gift was taken)
// POST /subscribed { initData, lang }  ->  { ok, reward, items, channel }  a heart, once, for being subscribed to the news channel
// POST /event     { initData, id, level }  ->  { ok }  a seasonal event level won; keeps the furthest level of this year's run
//   (the game keeps its own progress; this only lets the news channels count who has the event hat)
// POST /challenge { initData, reward }  ->  the daily challenge reward, once a day
// POST /notify    { initData, on, tz, room, lang }  ->  raid alerts on or off (on by default; tz: getTimezoneOffset minutes)
// POST /raid      { initData, id }  ->  { ok, late?, reward, items }  the raid bonus, if the raid was repelled in time
// cron (every hour): players with alerts on who haven't played for a while get, at most once a day and
//   between 10:00 and 21:00 their time, a raid alert with a picture and a button; they have 30 minutes
// POST /share     { initData, lang }  ->  { id }  an invite card (picture, text, Play button with the
//   player's referral link) prepared for WebApp.shareMessage; t.me Mini App links get no link preview
// cron (every hour): posts to the news channels (CHANNEL_UK, CHANNEL_EN) and the community group's Events topic
//   (COMMUNITY_GROUP), see "news channels" and "community group" below
// cron (Monday 00:05 UTC): the week's top 3 in Night Shift get prizes and a message from the bot
// POST /tg       the bot's webhook (set automatically on the first game request):
//   approves pre-checkout queries, records successful payments and refunds, answers /start,
//   and answers inline queries (@the_bot in any chat) with the player's invite card, in the language named
//   after the bot's name (@the_bot en) or the player's own.
// ADMIN_ID (secret, optional): the owner's Telegram id. The bot messages the owner about every
//   purchase and refund, and answers the owner's /sales with a sales summary. Other text sent to the
//   bot goes to the owner as a support message; the owner's reply to it goes back to that player.

const MAX_AGE = 7 * 24 * 3600; // initData older than this is refused
const LIMITS = { night: 500, stars: 400 }; // anything above is not a real result
const TOP = 20;
// Items sold for Telegram Stars (currency XTR). The price is checked again at pre-checkout.
// `grant` is what lands in the player's inventory once the payment succeeds.
const ITEMS = {
  continue: { stars: 10 },
  continue2: { stars: 20 }, // the second Second wind in the same run
  heart3: { stars: 15, grant: { heart: 3 } },
  meter3: { stars: 15, grant: { meter: 3 } },
  hat_party: { stars: 20, grant: { hat_party: 1 } },
  hat_crown: { stars: 40, grant: { hat_crown: 1 } },
  hat_bow: { stars: 20, grant: { hat_bow: 1 } },
  rainbow: { stars: 25, grant: { rainbow: 1 } },
  hero_spark: { stars: 150, grant: { hero_spark: 1 } },
  hero_rex: { stars: 150, grant: { hero_rex: 1 } },
};
const BOOSTERS = ['heart', 'meter', 'wind']; // the only items that get used up (wind: a free Second wind)
// login bonus by day of the streak (the 7th day restarts the cycle)
// the chest ripens every 6 hours; inside: a heart or a quick start, and now and then a free Second wind
// the robot album: each card's tiers (10 / 50 / 200 wins) pay out once
const ALBUM_TYPES = ['vac', 'spray', 'mop', 'brush', 'fan', 'rc', 'shield', 'split', 'magnet', 'mole', 'printer', 'bomb', 'mimic', 'turret', 'tesla', 'warp', 'cryo', 'jelly', 'boss'];
const ALBUM_GIFTS = [null, { meter: 1 }, { heart: 1 }, { wind: 1 }];
// weekly quests: three a week; each pays once, all three add a free Second wind
const QUEST_GIFTS = { knots: { meter: 1 }, robots: { heart: 1 }, bosses: { heart: 1 }, noko: { meter: 1 }, stars3: { heart: 1 }, night: { meter: 1 }, combos: { meter: 1 }, lasers: { meter: 1 } };
const QUESTS_ALL = { wind: 1 };
const CHAL_GIFT = { heart: 1 }; // the first win of the weekly challenge
const SUB_GIFT = { heart: 1 }; // once, for subscribing to the news channel
const CHEST_HOURS = 6;
const rollChest = () => { const r = Math.random(); return r < .1 ? { wind: 1 } : r < .55 ? { heart: 1 } : { meter: 1 }; };
const MISS_GIFT = { heart: 1, meter: 1 }; // for a player back after 3+ days away
const STREAK_GIFT_DAYS = 30; // every 30 days in a row: the party hat, or a free Second wind for those who have it
const DAILY = [{ meter: 1 }, { heart: 1 }, { meter: 1 }, { heart: 1 }, { meter: 2 }, { heart: 2 }, { wind: 1, heart: 1, meter: 1 }];
const RAID_GIFT = { heart: 1, meter: 1 }, RAID_MIN = 30, ROOMS_N = 18;
const REF_GIFT = { heart: 1, meter: 1 }; // for both the inviter and the new player
const REF_ROOM_GIFT = { wind: 1 }, REF_ROOM_LEVELS = 4; // for the inviter, once the friend has won the first room
const WEEK_PRIZES = [{ heart: 3, meter: 3 }, { heart: 2, meter: 2 }, { heart: 1, meter: 1 }];
const DAY = 86400000;
const utcDay = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);
function weekStart(ts = Date.now()) { // Monday 00:00 UTC of the week containing ts
  const d = new Date(ts), back = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back);
}
const weekKey = (ts = Date.now()) => utcDay(weekStart(ts));
const TEXT = {
  uk: { rooms: ['Кухня', 'Вітальня', 'Спальня', 'Ванна', 'Балкон', 'Горище', 'Гараж', 'Підвал', 'Дах', 'Сад', 'Серверна', 'Під\'їзд', 'Склад', 'Фабрика', 'Лабораторія', 'Космостанція', 'Полярна станція', 'Підводна база'], raid: room => `🚨 Тривога! Збунтована техніка напала на кімнату «${room}»!\n\nВідбий нальот за 30 хвилин і отримай бонус: ❤️ +1 серце і ⚡ +1 швидкий старт.`, raidBtn: '🐾 Відбити нальот',
    invite: 'Коти та єноти проти збунтованої техніки! Зіграй зі мною в Pawsling 🐾',
    sent: 'Дякуємо! Повідомлення передано розробнику.',
    refJoined: n => `${n} тепер у грі за твоїм запрошенням! Вам обом: +1 серце і +1 швидкий старт. А коли друг пройде першу кімнату, тобі — безкоштовне друге дихання.`,
    refRoom: n => `🎉 У ${n} уже позаду перша кімната! Подарунок за запрошеного друга: безкоштовне друге дихання 🌬, воно вже в грі.`,
    weekWin: (place, w) => `Тиждень «Нічної зміни» завершено: ти на ${place} місці (${w} хвиль)! Приз уже в магазині.`,
    items: { heart3: ['Серце+ ×3', '+1 серце кожному героєві на 3 рівні.'], meter3: ['Швидкий старт ×3', 'Пів шкали «Бешкету» на старті 3 рівнів.'], hat_party: ['Святковий ковпак', 'Капелюшок для всієї команди, назавжди.'], hat_crown: ['Корона', 'Корона для всієї команди, назавжди.'], hat_bow: ['Бантик', 'Бантик для всієї команди, назавжди.'], rainbow: ['Райдужна нитка', 'Нитки героїв переливаються веселкою, назавжди.'], hero_rex: ['Рекс', 'Новий герой: пес-рятувальник, що лікує друзів, яких зачепить.'], hero_spark: ['Іскра', 'Нова героїня: її удар перескакує блискавкою на найближчого ворога.'] },
    title: 'Друге дихання', desc: 'Продовж рівень: повна міцність квартири й усі герої знову на ногах.',
    start: n => `Привіт, ${n}! Збунтована техніка захопила квартиру. Запускай котів і єнотів, як з рогатки!`, play: '🐾 Грати',
    cardTitle: 'Запросити в Pawsling', cardDesc: 'Картка з кнопкою «Грати» і твоїм запрошенням: обом по бонусу', textTitle: 'Запрошення текстом', textDesc: 'Те саме, але без картинки', recTitle: 'Кинути виклик', recDesc: 'Покажи свій рекорд і запроси побити його', rec: (st, w) => `🏆 Мій рекорд у Pawsling: ⭐ ${st}${w ? ` · 🌙 «Нічна зміна»: ${w}` : ''}. Спробуєш побити?`, share: '📨 Запросити друга', shareText: 'Обери чат, і я надішлю туди картку з запрошенням. Коли друг зайде за нею в гру, ви обидва отримаєте +1 серце і +1 швидкий старт.', startQ: 'Кого запросимо?',
    streakEnds: (n, h) => `🔥 Твоя серія ${n} дн. згорить через ${h} год! Зайди в Pawsling і забери бонус дня.`,
    passNight: (name, me, them) => `🌙 ${name} випереджає тебе в «Нічній зміні»: ${me} проти твоїх ${them}. Відіграєшся?`,
    passStars: (name, me, them) => `⭐ ${name} випереджає тебе за зірками: ${me} проти твоїх ${them}. Наздоженеш?`, friendsBtn: '🏆 Рейтинг друзів',
    chestReady: '🎁 Твоя скриня в Pawsling дозріла й чекає! Відкрий і забери подарунок.',
    missYou: '🐾 Ми скучили! Коти та єноти тримають для тебе подарунок: ❤️ +1 серце і ⚡ +1 швидкий старт. Вони вже в грі.' },
  en: { rooms: ['Kitchen', 'Living room', 'Bedroom', 'Bathroom', 'Balcony', 'Attic', 'Garage', 'Basement', 'Roof', 'Garden', 'Server room', 'Stairwell', 'Warehouse', 'Factory', 'Lab', 'Space station', 'Polar station', 'Underwater base'], raid: room => `🚨 Alert! Rebel robots are raiding your home: ${room}!\n\nRepel the raid within 30 minutes and get a bonus: ❤️ +1 heart and ⚡ +1 quick start.`, raidBtn: '🐾 Repel the raid',
    invite: 'Cats and raccoons vs rebel robots! Play Pawsling with me 🐾',
    sent: 'Thanks! Your message has been sent to the developer.',
    refJoined: n => `${n} joined the game with your invite! You both get +1 heart and +1 quick start. And once your friend clears the first room, you get a free Second wind.`,
    refRoom: n => `🎉 ${n} has cleared the first room! Your gift for bringing a friend: a free Second wind 🌬, already in the game.`,
    weekWin: (place, w) => `The Night Shift week is over: you finished #${place} (${w} waves)! Your prize is in the shop.`,
    items: { heart3: ['Heart+ ×3', '+1 heart for every hero, for 3 levels.'], meter3: ['Quick start ×3', 'Half a Mischief meter at the start of 3 levels.'], hat_party: ['Party hat', 'A hat for the whole team, forever.'], hat_crown: ['Crown', 'A crown for the whole team, forever.'], hat_bow: ['Bow', 'A bow for the whole team, forever.'], rainbow: ['Rainbow yarn', 'Hero threads shimmer in rainbow colors, forever.'], hero_rex: ['Rex', 'A new hero: a rescue dog that heals every friend he touches.'], hero_spark: ['Sparky', 'A new hero: her hits arc like lightning to the nearest enemy.'] },
    title: 'Second wind', desc: 'Continue the level: full home strength and every hero back on their feet.',
    start: n => `Hi, ${n}! Rebel robots have taken over the flat. Launch the cats and raccoons like a slingshot!`, play: '🐾 Play',
    cardTitle: 'Invite to Pawsling', cardDesc: 'A card with a Play button and your invite: a bonus for you both', textTitle: 'Invite as text', textDesc: 'The same, without the picture', recTitle: 'Challenge a friend', recDesc: 'Show your record and dare them to beat it', rec: (st, w) => `🏆 My Pawsling record: ⭐ ${st}${w ? ` · 🌙 Night Shift: ${w}` : ''}. Can you beat it?`, share: '📨 Invite a friend', shareText: 'Pick a chat and I will send an invite card there. When your friend joins through it, you both get +1 heart and +1 quick start.', startQ: 'Who shall we invite?',
    streakEnds: (n, h) => `🔥 Your ${n}-day streak ends in ${h}h! Open Pawsling and grab today's bonus.`,
    passNight: (name, me, them) => `🌙 ${name} is ahead of you in Night Shift: ${me} against your ${them}. Going to win it back?`,
    passStars: (name, me, them) => `⭐ ${name} is ahead of you in stars: ${me} against your ${them}. Can you catch up?`, friendsBtn: '🏆 Friends board',
    chestReady: '🎁 Your Pawsling chest is ripe and waiting! Open it and grab the gift.',
    missYou: '🐾 We miss you! The cats and raccoons saved you a gift: ❤️ +1 heart and ⚡ +1 quick start. It is already in the game.' },
  pl: { rooms: ['Kuchnia', 'Salon', 'Sypialnia', 'Łazienka', 'Balkon', 'Strych', 'Garaż', 'Piwnica', 'Dach', 'Ogród', 'Serwerownia', 'Klatka schodowa', 'Magazyn', 'Fabryka', 'Laboratorium', 'Stacja kosmiczna', 'Stacja polarna', 'Baza podwodna'], raid: room => `🚨 Alarm! Zbuntowane roboty napadły na pokój: ${room}!\n\nOdeprzyj nalot w 30 minut i zdobądź bonus: ❤️ +1 serce i ⚡ +1 szybki start.`, raidBtn: '🐾 Odeprzyj nalot',
    invite: 'Koty i szopy kontra zbuntowane roboty! Zagraj ze mną w Pawsling 🐾',
    sent: 'Dzięki! Wiadomość trafiła do twórcy gry.',
    refJoined: n => `${n} dołączył(a) do gry z twojego zaproszenia! Oboje dostajecie +1 serce i +1 szybki start. A gdy znajomy przejdzie pierwszy pokój, dostaniesz darmowy Drugi oddech.`,
    refRoom: n => `🎉 ${n} ma już za sobą pierwszy pokój! Prezent za zaproszenie znajomego: darmowy Drugi oddech 🌬, już czeka w grze.`,
    weekWin: (place, w) => `Tydzień nocnej zmiany zakończony: zajmujesz ${place}. miejsce (${w} fal)! Nagroda czeka w sklepie.`,
    items: { heart3: ['Serce+ ×3', '+1 serce dla każdego bohatera na 3 poziomy.'], meter3: ['Szybki start ×3', 'Pół paska psot na starcie 3 poziomów.'], hat_party: ['Czapeczka imprezowa', 'Czapka dla całej drużyny, na zawsze.'], hat_crown: ['Korona', 'Korona dla całej drużyny, na zawsze.'], hat_bow: ['Kokardka', 'Kokardka dla całej drużyny, na zawsze.'], rainbow: ['Tęczowa włóczka', 'Nitki bohaterów mienią się tęczą, na zawsze.'], hero_rex: ['Reks', 'Nowy bohater: pies ratownik, który leczy przyjaciół, których dotknie.'], hero_spark: ['Iskra', 'Nowa bohaterka: jej ciosy przeskakują piorunem na najbliższego wroga.'] },
    title: 'Drugi oddech', desc: 'Kontynuuj poziom: pełna wytrzymałość mieszkania i wszyscy bohaterowie znów na nogach.',
    start: n => `Cześć, ${n}! Zbuntowane roboty przejęły mieszkanie. Wystrzel koty i szopy jak z procy!`, play: '🐾 Graj',
    cardTitle: 'Zaproś do Pawsling', cardDesc: 'Karta z przyciskiem Graj i twoim zaproszeniem: bonus dla was obojga', textTitle: 'Zaproszenie tekstem', textDesc: 'To samo, ale bez obrazka', recTitle: 'Rzuć wyzwanie', recDesc: 'Pokaż swój rekord i zaproś do jego pobicia', rec: (st, w) => `🏆 Mój rekord w Pawsling: ⭐ ${st}${w ? ` · 🌙 Nocna zmiana: ${w}` : ''}. Pobijesz go?`, share: '📨 Zaproś znajomego', shareText: 'Wybierz czat, a wyślę tam kartę z zaproszeniem. Gdy znajomy dołączy przez nią, oboje dostaniecie +1 serce i +1 szybki start.', startQ: 'Kogo zapraszamy?',
    streakEnds: (n, h) => `🔥 Twoja seria ${n} dni przepadnie za ${h} godz.! Wejdź do Pawsling i odbierz dzisiejszy bonus.`,
    passNight: (name, me, them) => `🌙 ${name} wyprzedza cię w Nocnej zmianie: ${me} wobec twoich ${them}. Odegrasz się?`,
    passStars: (name, me, them) => `⭐ ${name} wyprzedza cię w gwiazdkach: ${me} wobec twoich ${them}. Dogonisz?`, friendsBtn: '🏆 Ranking znajomych',
    chestReady: '🎁 Twoja skrzynia w Pawsling dojrzała i czeka! Otwórz ją i odbierz prezent.',
    missYou: '🐾 Tęsknimy! Koty i szopy mają dla ciebie prezent: ❤️ +1 serce i ⚡ +1 szybki start. Już czeka w grze.' },
  de: { rooms: ['Küche', 'Wohnzimmer', 'Schlafzimmer', 'Badezimmer', 'Balkon', 'Dachboden', 'Garage', 'Keller', 'Dach', 'Garten', 'Serverraum', 'Treppenhaus', 'Lager', 'Fabrik', 'Labor', 'Raumstation', 'Polarstation', 'Unterwasserbasis'], raid: room => `🚨 Alarm! Rebellische Roboter überfallen den Raum: ${room}!\n\nWehr den Überfall in 30 Minuten ab und hol dir einen Bonus: ❤️ +1 Herz und ⚡ +1 Schnellstart.`, raidBtn: '🐾 Überfall abwehren',
    invite: 'Katzen und Waschbären gegen rebellische Roboter! Spiel Pawsling mit mir 🐾',
    sent: 'Danke! Deine Nachricht wurde an den Entwickler weitergeleitet.',
    refJoined: n => `${n} ist über deine Einladung ins Spiel gekommen! Ihr bekommt beide +1 Herz und +1 Schnellstart. Und schafft dein Freund den ersten Raum, bekommst du eine Zweite Luft gratis.`,
    refRoom: n => `🎉 ${n} hat den ersten Raum geschafft! Dein Geschenk fürs Einladen: eine Zweite Luft gratis 🌬, schon im Spiel.`,
    weekWin: (place, w) => `Die Nachtschicht-Woche ist vorbei: Platz ${place} (${w} Wellen)! Dein Preis liegt im Shop.`,
    items: { heart3: ['Herz+ ×3', '+1 Herz für jeden Helden, für 3 Level.'], meter3: ['Schnellstart ×3', 'Halbe Unfug-Leiste zu Beginn von 3 Leveln.'], hat_party: ['Partyhut', 'Ein Hut für das ganze Team, für immer.'], hat_crown: ['Krone', 'Eine Krone für das ganze Team, für immer.'], hat_bow: ['Schleife', 'Eine Schleife für das ganze Team, für immer.'], rainbow: ['Regenbogenwolle', 'Die Fäden der Helden schimmern in Regenbogenfarben, für immer.'], hero_rex: ['Rex', 'Ein neuer Held: ein Rettungshund, der jeden berührten Freund heilt.'], hero_spark: ['Funke', 'Eine neue Heldin: ihre Treffer springen als Blitz zum nächsten Gegner.'] },
    title: 'Zweite Luft', desc: 'Spiel weiter: volle Wohnungsstärke und alle Helden wieder auf den Beinen.',
    start: n => `Hallo, ${n}! Rebellische Roboter haben die Wohnung übernommen. Schieß Katzen und Waschbären wie mit einer Schleuder!`, play: '🐾 Spielen',
    cardTitle: 'Zu Pawsling einladen', cardDesc: 'Eine Karte mit Spielen-Knopf und deiner Einladung: ein Bonus für euch beide', textTitle: 'Einladung als Text', textDesc: 'Dasselbe ohne Bild', recTitle: 'Herausfordern', recDesc: 'Zeig deinen Rekord und fordere zum Schlagen heraus', rec: (st, w) => `🏆 Mein Pawsling-Rekord: ⭐ ${st}${w ? ` · 🌙 Nachtschicht: ${w}` : ''}. Schaffst du mehr?`, share: '📨 Freund einladen', shareText: 'Wähl einen Chat, und ich schicke dort eine Einladungskarte hin. Kommt dein Freund darüber ins Spiel, bekommt ihr beide +1 Herz und +1 Schnellstart.', startQ: 'Wen laden wir ein?',
    streakEnds: (n, h) => `🔥 Deine Serie von ${n} Tagen endet in ${h} Std.! Öffne Pawsling und hol dir den Tagesbonus.`,
    passNight: (name, me, them) => `🌙 ${name} liegt in der Nachtschicht vor dir: ${me} gegen deine ${them}. Holst du dir das zurück?`,
    passStars: (name, me, them) => `⭐ ${name} liegt bei den Sternen vor dir: ${me} gegen deine ${them}. Holst du auf?`, friendsBtn: '🏆 Freunde-Rangliste',
    chestReady: '🎁 Deine Pawsling-Truhe ist reif und wartet! Öffne sie und hol dir das Geschenk.',
    missYou: '🐾 Wir vermissen dich! Die Katzen und Waschbären haben ein Geschenk für dich: ❤️ +1 Herz und ⚡ +1 Schnellstart. Es liegt schon im Spiel.' },
  es: { rooms: ['Cocina', 'Salón', 'Dormitorio', 'Baño', 'Balcón', 'Desván', 'Garaje', 'Sótano', 'Tejado', 'Jardín', 'Sala de servidores', 'Escalera', 'Almacén', 'Fábrica', 'Laboratorio', 'Estación espacial', 'Estación polar', 'Base submarina'], raid: room => `🚨 ¡Alerta! ¡Los robots rebeldes asaltan la habitación: ${room}!\n\nRechaza el asalto en 30 minutos y gana un bonus: ❤️ +1 corazón y ⚡ +1 inicio rápido.`, raidBtn: '🐾 Rechazar el asalto',
    invite: '¡Gatos y mapaches contra robots rebeldes! Juega Pawsling conmigo 🐾',
    sent: '¡Gracias! Tu mensaje se ha enviado al desarrollador.',
    refJoined: n => `¡${n} se unió al juego con tu invitación! Los dos recibís +1 corazón y +1 inicio rápido. Y cuando tu amigo supere la primera sala, recibirás un Segundo aliento gratis.`,
    refRoom: n => `🎉 ¡${n} ya superó la primera sala! Tu regalo por traer a un amigo: un Segundo aliento gratis 🌬, ya está en el juego.`,
    weekWin: (place, w) => `Terminó la semana del turno de noche: quedaste en el puesto ${place} (${w} oleadas). ¡Tu premio está en la tienda!`,
    items: { heart3: ['Corazón+ ×3', '+1 corazón para cada héroe durante 3 niveles.'], meter3: ['Inicio rápido ×3', 'Media barra de travesura al empezar 3 niveles.'], hat_party: ['Gorro de fiesta', 'Un gorro para todo el equipo, para siempre.'], hat_crown: ['Corona', 'Una corona para todo el equipo, para siempre.'], hat_bow: ['Lazo', 'Un lazo para todo el equipo, para siempre.'], rainbow: ['Hilo arcoíris', 'Los hilos de los héroes brillan con los colores del arcoíris, para siempre.'], hero_rex: ['Rex', 'Un nuevo héroe: un perro de rescate que cura a cada amigo que toca.'], hero_spark: ['Chispa', 'Una nueva heroína: sus golpes saltan como un rayo al enemigo más cercano.'] },
    title: 'Segundo aliento', desc: 'Continúa el nivel: resistencia completa y todos los héroes de nuevo en pie.',
    start: n => `¡Hola, ${n}! Los robots rebeldes han tomado el piso. ¡Lanza a los gatos y mapaches como con un tirachinas!`, play: '🐾 Jugar',
    cardTitle: 'Invitar a Pawsling', cardDesc: 'Una tarjeta con botón Jugar y tu invitación: un bonus para los dos', textTitle: 'Invitación en texto', textDesc: 'Lo mismo, sin imagen', recTitle: 'Lanzar un reto', recDesc: 'Muestra tu récord y reta a superarlo', rec: (st, w) => `🏆 Mi récord en Pawsling: ⭐ ${st}${w ? ` · 🌙 Turno de noche: ${w}` : ''}. ¿Lo superas?`, share: '📨 Invitar a un amigo', shareText: 'Elige un chat y enviaré allí una tarjeta de invitación. Cuando tu amigo entre por ella, los dos recibiréis +1 corazón y +1 inicio rápido.', startQ: '¿A quién invitamos?',
    streakEnds: (n, h) => `🔥 ¡Tu racha de ${n} días termina en ${h} h! Entra en Pawsling y recoge el bonus de hoy.`,
    passNight: (name, me, them) => `🌙 ${name} te supera en el Turno de noche: ${me} frente a tus ${them}. ¿Lo recuperas?`,
    passStars: (name, me, them) => `⭐ ${name} te supera en estrellas: ${me} frente a tus ${them}. ¿Lo alcanzas?`, friendsBtn: '🏆 Clasificación de amigos',
    chestReady: '🎁 ¡Tu cofre de Pawsling ya está listo y te espera! Ábrelo y recoge el regalo.',
    missYou: '🐾 ¡Te echamos de menos! Los gatos y mapaches te guardan un regalo: ❤️ +1 corazón y ⚡ +1 inicio rápido. Ya está en el juego.' },
};
const text = code => TEXT[(code || '').slice(0, 2)] || TEXT.en;
// texts in the language the player chose in the game, or their Telegram app language before they have played
async function userText(env, from) {
  await ensureTables(env.DB);
  const row = from ? await env.DB.prepare('SELECT lang FROM notify WHERE user_id = ?1').bind(from.id).first() : null;
  return text((row && row.lang) || (from && from.language_code));
}

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url), path = url.pathname;
    if (req.method !== 'POST' || !['/board', '/invoice', '/inventory', '/use', '/daily', '/challenge', '/share', '/notify', '/raid', '/chest', '/album', '/quest', '/chal', '/subscribed', '/event', '/tg'].includes(path)) return json({ error: 'not found' }, 404);

    if (path === '/tg') {
      // only Telegram knows the secret we gave it in setWebhook
      if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== await hookSecret(env)) return new Response('forbidden', { status: 403 });
      try { await onUpdate(env, await req.json()); } catch (e) { console.log('update failed', e && e.message); }
      return new Response('ok');
    }

    let body;
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const user = await verify(body.initData, env.BOT_TOKEN);
    if (!user || !user.id) return json({ error: 'unauthorized' }, 401);
    try { await ensureHook(env, url.origin); } catch (e) { console.log('webhook check failed', e && e.message); }

    if (path === '/invoice') {
      const item = ITEMS[body.item];
      if (!item) return json({ error: 'unknown item' }, 400);
      const t = text(body.lang || user.language_code);
      const [title, description] = (t.items && t.items[body.item]) || [t.title, t.desc];
      const r = await tg(env, 'createInvoiceLink', {
        title, description, currency: 'XTR',
        payload: JSON.stringify({ item: body.item, u: user.id }),
        prices: [{ label: title, amount: item.stars }],
      });
      if (!r.ok) return json({ error: 'invoice failed' }, 502);
      return json({ link: r.result });
    }
    if (path === '/inventory') return json({ items: await inventory(env.DB, user.id) });
    if (path === '/use') {
      if (!BOOSTERS.includes(body.item)) return json({ error: 'not a booster' }, 400);
      await ensureTables(env.DB);
      const r = await env.DB.prepare('UPDATE inventory SET count = count - 1 WHERE user_id = ?1 AND item = ?2 AND count > 0')
        .bind(user.id, body.item).run();
      return json({ ok: r.meta.changes > 0, items: await inventory(env.DB, user.id) });
    }

    if (path === '/daily') return json(await daily(env, user, body));
    if (path === '/subscribed') {
      // the news channel gift: a heart, once, if Telegram says the player is in the channel (the bot is an admin there)
      await ensureTables(env.DB);
      const row = await env.DB.prepare('SELECT lang FROM notify WHERE user_id = ?1').bind(user.id).first();
      const channel = newsChat(env, body.lang || (row && row.lang) || user.language_code);
      if (!channel) return json({ ok: false, reward: null, channel: null });
      if (await env.DB.prepare('SELECT 1 AS x FROM subs WHERE user_id = ?1').bind(user.id).first()) return json({ ok: true, reward: null, items: await inventory(env.DB, user.id), channel });
      const cm = await tg(env, 'getChatMember', { chat_id: channel, user_id: user.id });
      const st = cm.ok ? cm.result : {};
      if (!(['member', 'administrator', 'creator'].includes(st.status) || (st.status === 'restricted' && st.is_member))) return json({ ok: false, reward: null, channel });
      const r = await env.DB.prepare('INSERT OR IGNORE INTO subs (user_id, chat, at) VALUES (?1, ?2, ?3)').bind(user.id, channel, Math.floor(Date.now() / 1000)).run();
      const reward = r.meta.changes > 0 ? SUB_GIFT : null;
      if (reward) await grant(env.DB, user.id, reward);
      return json({ ok: true, reward, items: await inventory(env.DB, user.id), channel });
    }
    if (path === '/event') {
      const ev = eventToday(), level = Number(body.level);
      if (!ev || body.id !== ev.id || !Number.isInteger(level) || level < 1 || level > EV_LEVELS) return json({ error: 'bad event' }, 400);
      await ensureTables(env.DB);
      await env.DB.prepare(`INSERT INTO event_runs (user_id, ev_key, levels, at) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(user_id, ev_key) DO UPDATE SET levels = excluded.levels, at = excluded.at WHERE excluded.levels > event_runs.levels`)
        .bind(user.id, ev.key, level, Math.floor(Date.now() / 1000)).run();
      return json({ ok: true });
    }
    if (path === '/chal') {
      // the weekly challenge: keep the best (fewest turns) win of the week; the first win gives a heart
      const week = weekKey(), turns = clampInt(body.turns, 300);
      await ensureTables(env.DB);
      let first = false;
      if (turns && body.week === week) {
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(`INSERT INTO chal (week, user_id, name, turns, at) VALUES (?1, ?2, ?3, ?4, ?5)
          ON CONFLICT(week, user_id) DO UPDATE SET name = excluded.name, turns = excluded.turns, at = excluded.at WHERE excluded.turns < chal.turns`)
          .bind(week, user.id, displayName(user), turns, now).run();
        // the album table doubles as a ledger of one-time gifts: 'chal:<week>' marks this week's first win
        const mark = await env.DB.prepare('INSERT OR IGNORE INTO album (user_id, card) VALUES (?1, ?2)').bind(user.id, 'chal:' + week).run();
        first = mark.meta.changes > 0;
        if (first) await grant(env.DB, user.id, CHAL_GIFT);
      }
      return json({ ...(await chalBoard(env.DB, user.id, week)), first, items: await inventory(env.DB, user.id) });
    }
    if (path === '/quest') {
      // a weekly quest is done: its gift, once; the third one of the week adds the bonus
      const id = String(body.id || ''), week = weekKey();
      if (!QUEST_GIFTS[id] || body.week !== week) return json({ error: 'bad quest' }, 400);
      await ensureTables(env.DB);
      const had = await env.DB.prepare('SELECT COUNT(*) AS n FROM quests WHERE user_id = ?1 AND week = ?2').bind(user.id, week).first();
      if (had.n >= 3) return json({ ok: false, items: await inventory(env.DB, user.id) });
      const r = await env.DB.prepare('INSERT OR IGNORE INTO quests (user_id, week, quest) VALUES (?1, ?2, ?3)').bind(user.id, week, id).run();
      let bonus = null;
      if (r.meta.changes > 0) {
        await grant(env.DB, user.id, QUEST_GIFTS[id]);
        if (had.n + 1 === 3) { bonus = QUESTS_ALL; await grant(env.DB, user.id, bonus); }
      }
      return json({ ok: r.meta.changes > 0, bonus, items: await inventory(env.DB, user.id) });
    }
    if (path === '/album') {
      // a card reached a new tier: its gift, once
      const type = String(body.type || ''), tier = Math.floor(Number(body.tier));
      if (!ALBUM_TYPES.includes(type) || !(tier >= 1 && tier <= 3)) return json({ error: 'bad card' }, 400);
      await ensureTables(env.DB);
      const r = await env.DB.prepare('INSERT OR IGNORE INTO album (user_id, card) VALUES (?1, ?2)').bind(user.id, type + ':' + tier).run();
      if (r.meta.changes > 0) await grant(env.DB, user.id, ALBUM_GIFTS[tier]);
      return json({ ok: r.meta.changes > 0, reward: r.meta.changes > 0 ? ALBUM_GIFTS[tier] : null, items: await inventory(env.DB, user.id) });
    }
    if (path === '/chest') {
      // open the chest if it is ripe; either way answer with when the next one is ready
      await ensureTables(env.DB);
      const now = Math.floor(Date.now() / 1000), next = now + CHEST_HOURS * 3600;
      const r = await env.DB.prepare('UPDATE chests SET ready_at = ?3 WHERE user_id = ?1 AND ready_at <= ?2').bind(user.id, now, next).run();
      let reward = null;
      if (r.meta.changes > 0) { reward = rollChest(); await grant(env.DB, user.id, reward); }
      const row = await env.DB.prepare('SELECT ready_at FROM chests WHERE user_id = ?1').bind(user.id).first();
      return json({ ok: !!reward, reward, readyAt: (row ? row.ready_at : now) * 1000, items: await inventory(env.DB, user.id) });
    }
    if (path === '/notify') {
      await ensureTables(env.DB);
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(`INSERT INTO notify (user_id, enabled, lang, tz, room, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled, lang = excluded.lang, tz = excluded.tz, room = excluded.room, last_seen = excluded.last_seen, blocked = 0`)
        .bind(user.id, body.on ? 1 : 0, String(body.lang || user.language_code || '').slice(0, 5), clampTz(body.tz), clampRoom(body.room), now).run();
      return json({ ok: true, on: !!body.on });
    }
    if (path === '/raid') {
      await ensureTables(env.DB);
      const now = Math.floor(Date.now() / 1000), id = Math.floor(Number(body.id)) || 0;
      // a minute of grace for a win that lands just as the timer runs out
      const r = await env.DB.prepare('UPDATE raids SET done = ?3 WHERE id = ?1 AND user_id = ?2 AND done IS NULL AND expires + 60 >= ?3')
        .bind(id, user.id, now).run();
      if (r.meta.changes > 0) await grant(env.DB, user.id, RAID_GIFT);
      return json({ ok: r.meta.changes > 0, late: r.meta.changes === 0, reward: RAID_GIFT, items: await inventory(env.DB, user.id) });
    }
    if (path === '/share') {
      if (!botName) { const me = await tg(env, 'getMe', {}); botName = me.ok ? me.result.username : null; }
      const r = await tg(env, 'savePreparedInlineMessage', {
        user_id: user.id, allow_user_chats: true, allow_group_chats: true, allow_channel_chats: true,
        result: inviteCard(text(body.lang || user.language_code), user.id),
      });
      return r.ok ? json({ id: r.result.id }) : json({ error: 'share failed' }, 502);
    }
    if (path === '/challenge') {
      if (!BOOSTERS.includes(body.reward)) return json({ error: 'bad reward' }, 400);
      await ensureTables(env.DB);
      const today = utcDay();
      const r = await env.DB.prepare(`INSERT INTO daily (user_id, streak, challenge_day, lang) VALUES (?1, 0, ?2, ?3)
        ON CONFLICT(user_id) DO UPDATE SET challenge_day = excluded.challenge_day WHERE daily.challenge_day IS NOT excluded.challenge_day`)
        .bind(user.id, today, user.language_code || '').run();
      if (r.meta.changes > 0) await grant(env.DB, user.id, { [body.reward]: 1 });
      return json({ ok: r.meta.changes > 0, items: await inventory(env.DB, user.id) });
    }

    await ensureTables(env.DB);
    const night = clampInt(body.night, LIMITS.night), stars = clampInt(body.stars, LIMITS.stars), week = clampInt(body.week, LIMITS.night);
    if (night || stars) await save(env, user, night, stars);
    if (clampInt(body.levels, 500) >= REF_ROOM_LEVELS) await refRoomDone(env, user);
    if (week) await saveWeek(env.DB, user, week);

    if (body.board === 'week') return json(await weekBoard(env.DB, user.id));
    if (body.board === 'friends') return json(await friendsBoard(env.DB, user.id));
    if (body.board === 'chal') return json(await chalBoard(env.DB, user.id, weekKey()));
    if (body.board !== 'night' && body.board !== 'stars') return json({ ok: true });
    return json(await board(env.DB, body.board, user.id));
  },

  async scheduled(event, env, ctx) { ctx.waitUntil(event.cron === '5 0 * * 1' ? awardWeek(env) : Promise.all([sendRaids(env), sendStreakReminders(env), sendChestPings(env), sendMissYou(env), sendChannelPosts(env)])); },
};

// ---------- daily bonus, challenge, invites ----------
let botName = null;
async function daily(env, user, body = {}) {
  const db = env.DB;
  await ensureTables(db);
  // remember when this player was last here (raids skip people who are playing anyway)
  const now = Math.floor(Date.now() / 1000);
  // raid alerts are on by default; a player can turn them off with the bell in the game
  await db.prepare('INSERT OR IGNORE INTO notify (user_id, enabled, lang, tz, room, last_seen) VALUES (?1, 1, ?2, ?3, ?4, ?5)')
    .bind(user.id, String(body.lang || user.language_code || '').slice(0, 5), clampTz(body.tz), clampRoom(body.room), now).run();
  // the game's language wins over the Telegram app's, so the bot follows a language switch in the game
  await db.prepare("UPDATE notify SET last_seen = ?2, tz = ?3, room = ?4, lang = COALESCE(NULLIF(?5, ''), lang) WHERE user_id = ?1")
    .bind(user.id, now, clampTz(body.tz), clampRoom(body.room), String(body.lang || '').slice(0, 5)).run();
  const nrow = await db.prepare('SELECT enabled, lang FROM notify WHERE user_id = ?1').bind(user.id).first();
  const raid = await db.prepare('SELECT id, room, expires FROM raids WHERE user_id = ?1 AND done IS NULL AND expires > ?2 ORDER BY id DESC LIMIT 1').bind(user.id, now).first();
  await db.prepare('INSERT OR IGNORE INTO chests (user_id, ready_at) VALUES (?1, ?2)').bind(user.id, now).run();
  const chest = await db.prepare('SELECT ready_at FROM chests WHERE user_id = ?1').bind(user.id).first();
  const today = utcDay(), yesterday = utcDay(Date.now() - DAY);
  const row = await db.prepare('SELECT last_day, streak, challenge_day FROM daily WHERE user_id = ?1').bind(user.id).first();
  const known = row || await db.prepare('SELECT 1 AS x FROM players WHERE id = ?1').bind(user.id).first();
  let claimed = false, streak = row ? row.streak : 0, reward = null, gifted = false, bonus = null;
  const srow = await db.prepare('SELECT run FROM streaks WHERE user_id = ?1').bind(user.id).first();
  let run = srow ? srow.run : streak; // players from before this counter start from their 7-day position
  if (!row || row.last_day !== today) {
    const next = row && row.last_day === yesterday ? row.streak % DAILY.length + 1 : 1;
    const r = await db.prepare(`INSERT INTO daily (user_id, last_day, streak, lang) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(user_id) DO UPDATE SET last_day = excluded.last_day, streak = excluded.streak, lang = excluded.lang
      WHERE daily.last_day IS NOT excluded.last_day`)
      .bind(user.id, today, next, user.language_code || '').run();
    streak = next;
    if (r.meta.changes > 0) {
      reward = DAILY[next - 1]; await grant(db, user.id, reward); claimed = true;
      run = row && row.last_day === yesterday ? run + 1 : 1;
      await db.prepare('INSERT INTO streaks (user_id, run) VALUES (?1, ?2) ON CONFLICT(user_id) DO UPDATE SET run = excluded.run').bind(user.id, run).run();
      if (run % STREAK_GIFT_DAYS === 0) {
        const hat = await db.prepare("SELECT count FROM inventory WHERE user_id = ?1 AND item = 'hat_party' AND count > 0").bind(user.id).first();
        bonus = hat ? { wind: 1 } : { hat_party: 1 };
        await grant(db, user.id, bonus);
      }
    }
  }
  // a brand-new player: remember where they came from (ref_<id> is kept as ref)
  if (!known && user.start) await db.prepare('INSERT OR IGNORE INTO sources (user_id, src, at) VALUES (?1, ?2, ?3)')
    .bind(user.id, user.start.replace(/^ref_\d+$/, 'ref').replace(/^raid_\d+$/, 'raid').slice(0, 40), now).run();
  // a brand-new player who came through a friend's link
  const m = /^ref_(\d+)$/.exec(user.start || '');
  if (!known && m && Number(m[1]) !== user.id) {
    const inviter = Number(m[1]);
    const r = await db.prepare('INSERT OR IGNORE INTO referrals (user_id, ref_by, at) VALUES (?1, ?2, ?3)').bind(user.id, inviter, Math.floor(Date.now() / 1000)).run();
    if (r.meta.changes > 0) {
      await grant(db, user.id, REF_GIFT); await grant(db, inviter, REF_GIFT); gifted = true;
      const il = await db.prepare('SELECT lang FROM daily WHERE user_id = ?1').bind(inviter).first();
      await tg(env, 'sendMessage', { chat_id: inviter, text: text(il && il.lang).refJoined(displayName(user)) });
    }
  }
  const inv = await db.prepare('SELECT COUNT(*) AS n FROM referrals WHERE ref_by = ?1').bind(user.id).first();
  if (!botName) { const me = await tg(env, 'getMe', {}); botName = me.ok ? me.result.username : null; }
  const news = newsChat(env, (nrow && nrow.lang) || user.language_code), newsUrl = channelUrl(news); // the game opens it by @username
  const newsDone = !!await db.prepare('SELECT 1 AS x FROM subs WHERE user_id = ?1').bind(user.id).first();
  return { claimed, streak, run, bonus, chestAt: chest.ready_at * 1000, reward, gifted, challengeDone: !!row && row.challenge_day === today, invited: inv.n, bot: botName,
    notify: !!(nrow && nrow.enabled), raid: raid ? { id: raid.id, room: raid.room, expires: raid.expires * 1000 } : null,
    items: await inventory(db, user.id), today, weekEnds: weekStart() + 7 * DAY, news: newsUrl ? news : null, newsDone };
}
// an invited player has won the first room: the inviter's gift, once per invited player
async function refRoomDone(env, user) {
  const db = env.DB, ref = await db.prepare('SELECT ref_by FROM referrals WHERE user_id = ?1').bind(user.id).first();
  if (!ref) return;
  const r = await db.prepare('INSERT OR IGNORE INTO ref_rooms (user_id, at) VALUES (?1, ?2)').bind(user.id, Math.floor(Date.now() / 1000)).run();
  if (!r.meta.changes) return;
  await grant(db, ref.ref_by, REF_ROOM_GIFT);
  const il = await db.prepare('SELECT lang FROM daily WHERE user_id = ?1').bind(ref.ref_by).first();
  await tg(env, 'sendMessage', { chat_id: ref.ref_by, text: text(il && il.lang).refRoom(displayName(user)) });
}
async function grant(db, id, g) {
  await db.batch(Object.entries(g).map(([k, n]) => db.prepare(
    'INSERT INTO inventory (user_id, item, count) VALUES (?1, ?2, ?3) ON CONFLICT(user_id, item) DO UPDATE SET count = count + excluded.count',
  ).bind(id, k, n)));
}

// ---------- weekly Night Shift tournament ----------
async function saveWeek(db, user, night) {
  await db.prepare(`INSERT INTO weekly (week, user_id, name, lang, night, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(week, user_id) DO UPDATE SET name = excluded.name, lang = excluded.lang,
      at = CASE WHEN excluded.night > weekly.night THEN excluded.at ELSE weekly.at END,
      night = MAX(weekly.night, excluded.night)`)
    .bind(weekKey(), user.id, displayName(user), user.language_code || '', night, Math.floor(Date.now() / 1000)).run();
}
async function weekBoard(db, id) {
  const wk = weekKey();
  const top = await db.prepare(`SELECT user_id AS id, name, night AS value FROM weekly WHERE week = ?1 AND night > 0 ORDER BY night DESC, at ASC LIMIT ${TOP}`).bind(wk).all();
  const me = await db.prepare('SELECT night AS value, at FROM weekly WHERE week = ?1 AND user_id = ?2').bind(wk, id).first();
  let mine = null;
  if (me && me.value > 0) {
    const ahead = await db.prepare('SELECT COUNT(*) AS n FROM weekly WHERE week = ?1 AND (night > ?2 OR (night = ?2 AND at < ?3))').bind(wk, me.value, me.at).first();
    mine = { rank: ahead.n + 1, value: me.value };
  }
  return { board: 'week', top: top.results.map((r, i) => ({ rank: i + 1, name: r.name, value: r.value, me: r.id === id })), me: mine,
    endsAt: weekStart() + 7 * DAY };
}
async function awardWeek(env) {
  const db = env.DB;
  await ensureTables(db);
  const wk = weekKey(Date.now() - 3 * DAY); // the cron runs early on Monday: award the week that just ended
  const done = await db.prepare('INSERT OR IGNORE INTO week_awards (week, at) VALUES (?1, ?2)').bind(wk, Math.floor(Date.now() / 1000)).run();
  if (done.meta.changes === 0) return;
  const top = await db.prepare('SELECT user_id, lang, night FROM weekly WHERE week = ?1 AND night > 0 ORDER BY night DESC, at ASC LIMIT 3').bind(wk).all();
  for (const [i, r] of top.results.entries()) {
    await grant(db, r.user_id, WEEK_PRIZES[i]);
    try { await tg(env, 'sendMessage', { chat_id: r.user_id, text: text(r.lang).weekWin(i + 1, r.night) }); } catch {}
  }
}

// ---------- Telegram Bot API ----------
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try { return await r.json(); } catch (e) { return { ok: false, description: 'HTTP ' + r.status }; }
}
// the webhook secret is derived from the bot token, so there is nothing extra to configure
async function hookSecret(env) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode('pawsling-hook:' + env.BOT_TOKEN));
  return hex(new Uint8Array(d)).slice(0, 48);
}
let hookReady = false; // per isolate: check the webhook once, not on every request
async function ensureHook(env, origin) {
  if (hookReady) return;
  const url = origin + '/tg';
  const info = await tg(env, 'getWebhookInfo', {});
  const want = ['message', 'pre_checkout_query', 'inline_query', 'my_chat_member'];
  const have = (info.ok && info.result.allowed_updates) || [];
  if (!(info.ok && info.result.url === url) || want.some(k => !have.includes(k))) {
    await tg(env, 'setWebhook', { url, secret_token: await hookSecret(env), allowed_updates: want });
  }
  hookReady = true;
}
let tablesReady = false;
async function ensureTables(db) {
  if (tablesReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT NOT NULL, night INTEGER NOT NULL DEFAULT 0,
      stars INTEGER NOT NULL DEFAULT 0, night_at INTEGER NOT NULL DEFAULT 0, stars_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_night ON players (night DESC, night_at ASC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_stars ON players (stars DESC, stars_at ASC)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS purchases (charge_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
      item TEXT NOT NULL, stars INTEGER NOT NULL, at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory (user_id INTEGER NOT NULL, item TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, item))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS daily (user_id INTEGER PRIMARY KEY, last_day TEXT, streak INTEGER NOT NULL DEFAULT 0,
      challenge_day TEXT, lang TEXT)`),
    db.prepare('CREATE TABLE IF NOT EXISTS referrals (user_id INTEGER PRIMARY KEY, ref_by INTEGER NOT NULL, at INTEGER NOT NULL)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS weekly (week TEXT NOT NULL, user_id INTEGER NOT NULL, name TEXT NOT NULL, lang TEXT,
      night INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY (week, user_id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_weekly ON weekly (week, night DESC, at ASC)'),
    db.prepare('CREATE TABLE IF NOT EXISTS week_awards (week TEXT PRIMARY KEY, at INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS refunds (charge_id TEXT PRIMARY KEY, at INTEGER NOT NULL)'),
    // days in a row, uncapped (daily.streak only cycles through the seven login rewards)
    db.prepare('CREATE TABLE IF NOT EXISTS streaks (user_id INTEGER PRIMARY KEY, run INTEGER NOT NULL DEFAULT 0)'),
    // the day a player last got a streak reminder, and the day they last got a friend note (one of each a day at most)
    db.prepare('CREATE TABLE IF NOT EXISTS pings (user_id INTEGER PRIMARY KEY, streak_day TEXT, friend_day TEXT)'),
    db.prepare('CREATE TABLE IF NOT EXISTS chests (user_id INTEGER PRIMARY KEY, ready_at INTEGER NOT NULL, ping_day TEXT)'),
    // when a player away for days was last sent the 'we miss you' gift
    db.prepare('CREATE TABLE IF NOT EXISTS comebacks (user_id INTEGER PRIMARY KEY, at INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS ref_rooms (user_id INTEGER PRIMARY KEY, at INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS album (user_id INTEGER NOT NULL, card TEXT NOT NULL, PRIMARY KEY (user_id, card))'),
    db.prepare('CREATE TABLE IF NOT EXISTS quests (user_id INTEGER NOT NULL, week TEXT NOT NULL, quest TEXT NOT NULL, PRIMARY KEY (user_id, week, quest))'),
    db.prepare(`CREATE TABLE IF NOT EXISTS chal (week TEXT NOT NULL, user_id INTEGER NOT NULL, name TEXT NOT NULL, turns INTEGER NOT NULL,
      at INTEGER NOT NULL, PRIMARY KEY (week, user_id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_chal ON chal (week, turns ASC, at ASC)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS notify (user_id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, lang TEXT, tz INTEGER NOT NULL DEFAULT 0,
      room INTEGER NOT NULL DEFAULT 0, last_seen INTEGER, last_raid INTEGER, blocked INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS raids (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, room INTEGER NOT NULL,
      created INTEGER NOT NULL, expires INTEGER NOT NULL, done INTEGER)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_raids_user ON raids (user_id, id)'),
    // channel posts already made (one per slot), and where new players came from (their first start_param)
    db.prepare('CREATE TABLE IF NOT EXISTS channel_posts (chat TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, msg_id INTEGER, PRIMARY KEY (chat, key))'),
    db.prepare('CREATE TABLE IF NOT EXISTS sources (user_id INTEGER PRIMARY KEY, src TEXT NOT NULL, at INTEGER NOT NULL)'),
    // who has taken the news channel gift (once per player)
    // the community group's topics, made by /chan group
    db.prepare('CREATE TABLE IF NOT EXISTS group_topics (chat TEXT NOT NULL, key TEXT NOT NULL, thread_id INTEGER NOT NULL, PRIMARY KEY (chat, key))'),
    db.prepare('CREATE TABLE IF NOT EXISTS subs (user_id INTEGER PRIMARY KEY, chat TEXT NOT NULL, at INTEGER NOT NULL)'),
    // seasonal events: the furthest level each player has won in each year's run (ev_key: halloween-2026)
    db.prepare('CREATE TABLE IF NOT EXISTS event_runs (user_id INTEGER NOT NULL, ev_key TEXT NOT NULL, levels INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, ev_key))'),
    db.prepare(`CREATE TABLE IF NOT EXISTS raid_runs (at INTEGER PRIMARY KEY, checked INTEGER NOT NULL, sent INTEGER NOT NULL,
      failed INTEGER NOT NULL, err TEXT)`),
  ]);
  tablesReady = true;
}
async function inventory(db, id) {
  await ensureTables(db);
  const rows = await db.prepare('SELECT item, count FROM inventory WHERE user_id = ?1 AND count > 0').bind(id).all();
  return Object.fromEntries(rows.results.map(r => [r.item, r.count]));
}
// the invite: a picture, a line of text and a Play button carrying the sender's referral link
const ART = 'https://vitaliivepsha.github.io/pawsling/promo/', CARD = 'invite-card-1280x720.jpg', CARD_THUMB = 'invite-card-640x360.jpg';
const playKb = (t, uid) => ({ inline_keyboard: [[{ text: t.play, url: `https://t.me/${botName}?startapp=ref_${uid}` }]] });
function inviteCard(t, uid, caption = t.invite, id = 'invite-' + uid) {
  return { type: 'photo', id, photo_url: ART + CARD, thumbnail_url: ART + CARD_THUMB, photo_width: 1280, photo_height: 720,
    title: t.cardTitle, description: t.cardDesc, caption, reply_markup: playKb(t, uid) };
}
// a word after @the_bot picks the cards' language: a code or a language's name in English, in it, or in Ukrainian
const INLINE_LANGS = {
  uk: { words: ['uk', 'ua', 'укр', 'ukr', 'ukrainian'], hint: 'Інша мова: допиши en, pl, de або es' },
  en: { words: ['en', 'eng', 'english', 'англ'], hint: 'Other language: add uk, pl, de or es' },
  pl: { words: ['pl', 'pol', 'polish', 'польськ'], hint: 'Inny język: dopisz uk, en, de lub es' },
  de: { words: ['de', 'deu', 'deutsch', 'german', 'нім'], hint: 'Andere Sprache: schreib uk, en, pl oder es dazu' },
  es: { words: ['es', 'esp', 'español', 'espanol', 'spanish', 'іспан'], hint: 'Otro idioma: añade uk, en, pl o de' },
};
function inlineLang(query) {
  const w = String(query || '').trim().toLowerCase().split(/\s+/)[0];
  if (!w) return null;
  // two-letter codes match exactly, longer words by their start ("англійською", "polski")
  return Object.keys(INLINE_LANGS).find(l => INLINE_LANGS[l].words.some(a => a.length < 3 ? w === a : w.startsWith(a) || (w.length >= 3 && a.startsWith(w)))) || null;
}
// typing @the_bot in any chat: the invite card, the player's record as a challenge, and a text-only invite,
// in the player's language or the one named after the bot's name
async function inlineResults(env, from, query) {
  const lang = inlineLang(query), t = lang ? TEXT[lang] : await userText(env, from), uid = from.id;
  const code = Object.keys(TEXT).find(k => TEXT[k] === t) || 'en', hint = (INLINE_LANGS[code] || INLINE_LANGS.en).hint;
  const p = await env.DB.prepare('SELECT night, stars FROM players WHERE id = ?1').bind(uid).first();
  const out = [inviteCard(t, uid, t.invite, `invite-${uid}-${code}`)];
  if (p && (p.stars || p.night)) out.push({ ...inviteCard(t, uid, t.rec(p.stars, p.night), `record-${uid}-${code}`), title: t.recTitle, description: t.recDesc });
  out.push({ type: 'article', id: `text-${uid}-${code}`, title: t.textTitle, description: `${t.textDesc}\n${hint}`, thumbnail_url: ART + CARD_THUMB,
    input_message_content: { message_text: t.invite }, reply_markup: playKb(t, uid) });
  return out;
}
// the news channel in the player's language (Ukrainian for Ukrainian, English for everyone else)
const newsChat = (env, lang) => chatRef(text(lang) === TEXT.uk ? env.CHANNEL_UK : env.CHANNEL_EN);
function newsKb(env, t) {
  const url = channelUrl(newsChat(env, t === TEXT.uk ? 'uk' : 'en'));
  return url ? [{ text: t === TEXT.uk ? '📣 Новини гри' : '📣 Game news', url }] : [];
}
// the news channel and the community group's topic in the player's language, side by side
async function communityKb(env, t) {
  const row = newsKb(env, t), url = await groupTopicUrl(env, t === TEXT.uk ? 'uk' : 'en');
  if (url) row.push({ text: t === TEXT.uk ? '💬 Спільнота' : '💬 Community', url });
  return row.length ? [row] : [];
}
// a button that opens the chat picker with the invite ready (works once inline mode is on in @BotFather)
const shareKb = t => [{ text: t.share, switch_inline_query_chosen_chat: { query: '', allow_user_chats: true, allow_group_chats: true, allow_channel_chats: false, allow_bot_chats: false } }];
async function onUpdate(env, u) {
  if (u.my_chat_member) {
    if (u.my_chat_member.chat.type !== 'private') return; // the bot made a channel admin is not a player unblocking it
    // a player who blocks the bot gets no more alerts; unblocking lets them come back
    const st = u.my_chat_member.new_chat_member && u.my_chat_member.new_chat_member.status;
    await ensureTables(env.DB);
    await env.DB.prepare('UPDATE notify SET blocked = ?2 WHERE user_id = ?1').bind(u.my_chat_member.from.id, st === 'kicked' ? 1 : 0).run();
    return;
  }
  if (u.inline_query) {
    const q = u.inline_query;
    if (!botName) { const me = await tg(env, 'getMe', {}); botName = me.ok ? me.result.username : null; }
    await tg(env, 'answerInlineQuery', { inline_query_id: q.id, is_personal: true, cache_time: 60, results: await inlineResults(env, q.from, q.query) });
    return;
  }
  if (u.pre_checkout_query) {
    const q = u.pre_checkout_query;
    let item = null;
    try { item = ITEMS[JSON.parse(q.invoice_payload).item]; } catch {}
    const ok = !!item && q.currency === 'XTR' && q.total_amount === item.stars;
    await tg(env, 'answerPreCheckoutQuery', ok ? { pre_checkout_query_id: q.id, ok: true }
      : { pre_checkout_query_id: q.id, ok: false, error_message: 'This item is no longer available.' });
    return;
  }
  const m = u.message;
  if (!m) return;
  if (m.successful_payment) {
    const p = m.successful_payment;
    let item = '';
    try { item = JSON.parse(p.invoice_payload).item; } catch {}
    await ensureTables(env.DB);
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO purchases (charge_id, user_id, item, stars, at) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(p.telegram_payment_charge_id, m.from.id, item, p.total_amount, Math.floor(Date.now() / 1000)).run();
    const g = ITEMS[item] && ITEMS[item].grant;
    if (ins.meta.changes > 0) {
      if (g) await grant(env.DB, m.from.id, g);
      await notifyAdmin(env, `💰 ${buyer(m.from)} купує «${itemName(item)}» за ${p.total_amount} ⭐`);
    }
    return;
  }
  if (m.refunded_payment) {
    // a refund takes back what the purchase gave, as far as it is still there
    const p = m.refunded_payment;
    await ensureTables(env.DB);
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO refunds (charge_id, at) VALUES (?1, ?2)')
      .bind(p.telegram_payment_charge_id, Math.floor(Date.now() / 1000)).run();
    if (ins.meta.changes === 0) return;
    const row = await env.DB.prepare('SELECT user_id, item FROM purchases WHERE charge_id = ?1').bind(p.telegram_payment_charge_id).first();
    const g = row && ITEMS[row.item] && ITEMS[row.item].grant;
    if (g) await env.DB.batch(Object.entries(g).map(([k, n]) => env.DB.prepare(
      'UPDATE inventory SET count = MAX(0, count - ?3) WHERE user_id = ?1 AND item = ?2').bind(row.user_id, k, n)));
    await notifyAdmin(env, `↩️ Повернення: ${p.total_amount} ⭐ ${buyer(m.from)}${row ? ` за «${itemName(row.item)}»` : ''}`);
    return;
  }
  if (typeof m.text === 'string' && /^\/raidtest\b/.test(m.text) && isAdmin(env, m.from)) {
    // the owner can try a raid alert right away
    await ensureTables(env.DB);
    const row = await env.DB.prepare('SELECT lang, room FROM notify WHERE user_id = ?1').bind(m.from.id).first();
    const r = await sendRaid(env, m.from.id, (row && row.lang) || (m.from && m.from.language_code), row ? row.room : 0);
    if (!r.ok) await tg(env, 'sendMessage', { chat_id: m.chat.id, text: '⚠️ Не вдалося надіслати нальот: ' + (r.description || '') });
    return;
  }
  if (typeof m.text === 'string' && /^\/raidlog\b/.test(m.text) && isAdmin(env, m.from)) {
    const row = await env.DB.prepare('SELECT tz FROM notify WHERE user_id = ?1').bind(m.from.id).first();
    await tg(env, 'sendMessage', { chat_id: m.chat.id, text: await raidLog(env.DB, row ? row.tz : 0) });
    return;
  }
  if (typeof m.text === 'string' && /^\/chan\b/.test(m.text) && isAdmin(env, m.from)) {
    await channelCommand(env, m);
    return;
  }
  if (typeof m.text === 'string' && /^\/sales\b/.test(m.text) && isAdmin(env, m.from)) {
    await tg(env, 'sendMessage', { chat_id: m.chat.id, text: await salesReport(env.DB) });
    return;
  }
  // starting the bot or allowing it to write lets alerts through again after a block
  if (m.write_access_allowed || (typeof m.text === 'string' && /^\/start\b/.test(m.text))) {
    await ensureTables(env.DB);
    await env.DB.prepare('UPDATE notify SET blocked = 0 WHERE user_id = ?1').bind(m.from.id).run();
    if (m.write_access_allowed) return;
  }
  if (typeof m.text === 'string' && /^\/(start|play)\b/.test(m.text) && env.WEBAPP_URL) {
    const t = await userText(env, m.from);
    await tg(env, 'sendMessage', {
      chat_id: m.chat.id, text: t.start((m.from && m.from.first_name) || ''),
      // web_app buttons only work in private chats; in a group the button opens the Mini App by link
      reply_markup: { inline_keyboard: [[m.chat.type === 'private' ? { text: t.play, web_app: { url: env.WEBAPP_URL } } : { text: t.play, url: `https://t.me/${await ensureBotName(env)}?startapp` }],
        shareKb(t), ...await communityKb(env, t)] },
    });
    return;
  }
  if (typeof m.text === 'string' && /^\/invite\b/.test(m.text)) {
    const t = await userText(env, m.from);
    await tg(env, 'sendMessage', { chat_id: m.chat.id, text: t.shareText, reply_markup: { inline_keyboard: [shareKb(t)] } });
    return;
  }
  // support: players write to the bot, the owner gets the message and answers by replying to it
  if (m.chat && m.chat.type === 'private' && typeof m.text === 'string' && env.ADMIN_ID) {
    if (isAdmin(env, m.from)) {
      const ref = m.reply_to_message && /#u(\d+)/.exec(m.reply_to_message.text || '');
      if (!ref) return;
      const r = await tg(env, 'sendMessage', { chat_id: Number(ref[1]), text: `💬 ${m.text}` });
      await tg(env, 'sendMessage', { chat_id: m.chat.id, text: r.ok ? '✅ Відповідь надіслано' : `⚠️ Не вдалося надіслати: ${r.description || ''}` });
      return;
    }
    if (m.text.startsWith('/')) return;
    await notifyAdmin(env, `✉️ ${buyer(m.from)} #u${m.from.id}

${m.text.slice(0, 3500)}

↩️ Відповідь: зроби реплай на це повідомлення`);
    await tg(env, 'sendMessage', { chat_id: m.chat.id, text: text(m.from && m.from.language_code).sent });
  }
}

// ---------- owner: purchase notifications and /sales ----------
const isAdmin = (env, from) => !!(env.ADMIN_ID && from && String(from.id) === String(env.ADMIN_ID).trim());
const itemName = item => (TEXT.uk.items[item] || [])[0] || (item === 'continue' || item === 'continue2' ? TEXT.uk.title : item || '?');
const buyer = u => `${displayName(u || {})}${u && u.username ? ' @' + u.username : ''} (id ${u ? u.id : '?'})`;
async function notifyAdmin(env, msg) {
  if (!env.ADMIN_ID) return;
  try { await tg(env, 'sendMessage', { chat_id: String(env.ADMIN_ID).trim(), text: msg }); } catch (e) {}
}
async function salesReport(db) {
  await ensureTables(db);
  const now = Math.floor(Date.now() / 1000), paid = 'charge_id NOT IN (SELECT charge_id FROM refunds)';
  const period = async since => db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(stars), 0) AS s FROM purchases WHERE ${paid} AND at >= ?1`).bind(since).first();
  const [d1, d7, d30, all] = await Promise.all([period(now - 86400), period(now - 7 * 86400), period(now - 30 * 86400), period(0)]);
  const back = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(stars), 0) AS s FROM purchases WHERE charge_id IN (SELECT charge_id FROM refunds)`).first();
  const buyers = await db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM purchases WHERE ${paid}`).first();
  const top = await db.prepare(`SELECT item, COUNT(*) AS n, SUM(stars) AS s FROM purchases WHERE ${paid} GROUP BY item ORDER BY s DESC LIMIT 5`).all();
  const last = await db.prepare(`SELECT p.item, p.stars, p.at, p.user_id, pl.name FROM purchases p LEFT JOIN players pl ON pl.id = p.user_id
    WHERE ${paid.replace('charge_id', 'p.charge_id')} ORDER BY p.at DESC LIMIT 5`).all();
  const line = (label, r) => `${label}: ${r.n} ${r.n === 1 ? 'покупка' : r.n >= 2 && r.n <= 4 ? 'покупки' : 'покупок'} · ${r.s} ⭐`;
  const when = ts => new Date(ts * 1000).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const out = ['📊 Продажі Pawsling', '', line('За 24 год', d1), line('За 7 днів', d7), line('За 30 днів', d30), line('Усього', all),
    `Покупців: ${buyers.n}`];
  if (back.n) out.push(`Повернено: ${back.n} · ${back.s} ⭐ (не враховано вище)`);
  if (top.results.length) { out.push('', 'Найкраще продається:'); for (const r of top.results) out.push(`• ${itemName(r.item)} — ${r.n} × · ${r.s} ⭐`); }
  if (last.results.length) { out.push('', 'Останні покупки:'); for (const r of last.results) out.push(`• ${when(r.at)} · ${itemName(r.item)} · ${r.stars} ⭐ · ${r.name || 'id ' + r.user_id}`); }
  if (!all.n) out.push('', 'Поки що покупок немає.');
  return out.join('\n');
}

// ---------- raids: an alert from the bot, 30 minutes to repel it in the game ----------
const clampTz = v => Math.max(-840, Math.min(840, Math.round(Number(v)) || 0));
const clampRoom = v => Math.max(0, Math.min(ROOMS_N - 1, Math.floor(Number(v)) || 0));
async function sendRaid(env, uid, lang, maxRoom) {
  if (!botName) { const me = await tg(env, 'getMe', {}); botName = me.ok ? me.result.username : null; }
  const now = Math.floor(Date.now() / 1000), room = Math.floor(Math.random() * (clampRoom(maxRoom) + 1)), t = text(lang);
  const ins = await env.DB.prepare('INSERT INTO raids (user_id, room, created, expires) VALUES (?1, ?2, ?3, ?4)').bind(uid, room, now, now + RAID_MIN * 60).run();
  const id = ins.meta.last_row_id;
  const r = await tg(env, 'sendPhoto', {
    chat_id: uid, photo: `https://vitaliivepsha.github.io/pawsling/promo/raid/raid-${room}.jpg`, caption: t.raid(t.rooms[room]),
    reply_markup: { inline_keyboard: [[{ text: t.raidBtn, url: `https://t.me/${botName}?startapp=raid_${id}` }]] },
  });
  if (r.ok) await env.DB.prepare('UPDATE notify SET last_raid = ?2 WHERE user_id = ?1').bind(uid, now).run();
  else {
    await env.DB.prepare('DELETE FROM raids WHERE id = ?1').bind(id).run();
    if (r.error_code === 403) await env.DB.prepare('UPDATE notify SET blocked = 1 WHERE user_id = ?1').bind(uid).run();
  }
  return r;
}
async function sendRaids(env) {
  const db = env.DB;
  await ensureTables(db);
  const now = Math.floor(Date.now() / 1000), d = new Date();
  // alerts are on, not blocked, nothing sent in the last 20 hours, and not playing in the last 2 hours
  const rows = await db.prepare(`SELECT user_id, lang, tz, room FROM notify WHERE enabled = 1 AND blocked = 0
    AND (last_raid IS NULL OR last_raid < ?1) AND (last_seen IS NULL OR last_seen < ?2) LIMIT 300`).bind(now - 20 * 3600, now - 2 * 3600).all();
  let checked = 0, sent = 0, failed = 0, err = null;
  for (const r of rows.results) {
    const hour = Math.floor(((d.getUTCHours() * 60 + d.getUTCMinutes() - r.tz) % 1440 + 1440) % 1440 / 60);
    if (hour < 10 || hour > 20) continue;
    checked++;
    // a surprise hour between 10:00 and 20:00 local; on about a quarter of the days there is no raid at all
    if (Math.random() > .12) continue;
    let res;
    try { res = await sendRaid(env, r.user_id, r.lang, r.room); } catch (e) { res = { description: String(e) }; }
    if (res.ok) sent++; else { failed++; err = String(res.description || 'error').slice(0, 200); }
  }
  // a short log of the hourly runs for /raidlog
  await db.batch([
    db.prepare('INSERT OR REPLACE INTO raid_runs (at, checked, sent, failed, err) VALUES (?1, ?2, ?3, ?4, ?5)').bind(now, checked, sent, failed, err),
    db.prepare('DELETE FROM raid_runs WHERE at < ?1').bind(now - 3 * 86400),
  ]);
}
async function raidLog(db, tz) {
  await ensureTables(db);
  const runs = await db.prepare('SELECT * FROM raid_runs ORDER BY at DESC LIMIT 24').all();
  const users = await db.prepare('SELECT enabled, blocked, last_raid FROM notify').all();
  const hm = (t) => new Date((t - tz * 60) * 1000).toISOString().slice(5, 16).replace('T', ' ');
  const u = users.results, on = u.filter((x) => x.enabled && !x.blocked).length;
  const lines = [`🚨 Сигнали: увімкнено ${on} з ${u.length}, заблокували ${u.filter((x) => x.blocked).length}`,
    `Нальотів за добу: ${(await db.prepare('SELECT count(*) n FROM raids WHERE created > ?1').bind(Math.floor(Date.now() / 1000) - 86400).first()).n}`, ''];
  if (!runs.results.length) lines.push('Щогодинних запусків ще не було');
  for (const r of runs.results) lines.push(`${hm(r.at)} — у вікні ${r.checked}, надіслано ${r.sent}${r.failed ? `, помилок ${r.failed}: ${r.err}` : ''}`);
  return lines.join('\n');
}

function clampInt(v, max) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
}

function displayName(u) {
  const last = u.last_name ? ` ${[...u.last_name][0]}.` : '';
  const name = `${u.first_name || u.username || 'Player'}${last}`.trim();
  return [...name].slice(0, 24).join('');
}

async function save(env, user, night, stars) {
  const db = env.DB, now = Math.floor(Date.now() / 1000);
  const old = await db.prepare('SELECT night, stars FROM players WHERE id = ?1').bind(user.id).first();
  // SQLite evaluates every SET expression against the old row, so the *_at columns
  // compare with the previous best before it is replaced.
  await db.prepare(`
    INSERT INTO players (id, name, night, stars, night_at, stars_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      night_at = CASE WHEN excluded.night > players.night THEN excluded.night_at ELSE players.night_at END,
      night = MAX(players.night, excluded.night),
      stars_at = CASE WHEN excluded.stars > players.stars THEN excluded.stars_at ELSE players.stars_at END,
      stars = MAX(players.stars, excluded.stars),
      updated_at = excluded.updated_at
  `).bind(user.id, displayName(user), night, stars, now).run();
  // friends this player has just passed hear about it
  const was = { night: old ? old.night : 0, stars: old ? old.stars : 0 };
  if (night > was.night || stars > was.stars) {
    try { await tellPassedFriends(env, user, was, { night: Math.max(night, was.night), stars: Math.max(stars, was.stars) }); } catch (e) {}
  }
}
async function chalBoard(db, id, week) {
  const top = await db.prepare('SELECT user_id, name, turns FROM chal WHERE week = ?1 ORDER BY turns ASC, at ASC LIMIT 20').bind(week).all();
  const me = await db.prepare('SELECT turns, at FROM chal WHERE week = ?1 AND user_id = ?2').bind(week, id).first();
  const total = await db.prepare('SELECT COUNT(*) AS n FROM chal WHERE week = ?1').bind(week).first();
  let mine = null;
  if (me) {
    const ahead = await db.prepare('SELECT COUNT(*) AS n FROM chal WHERE week = ?1 AND (turns < ?2 OR (turns = ?2 AND at < ?3))').bind(week, me.turns, me.at).first();
    mine = { rank: ahead.n + 1, value: me.turns };
  }
  return { board: 'chal', week, total: total.n, top: top.results.map((r, i) => ({ rank: i + 1, name: r.name, value: r.turns, me: r.user_id === id })), me: mine };
}
// friends are the people a player invited and the one who invited them
async function friendIds(db, id) {
  const r = await db.prepare('SELECT ref_by AS f FROM referrals WHERE user_id = ?1 UNION SELECT user_id AS f FROM referrals WHERE ref_by = ?1').bind(id).all();
  return r.results.map(x => x.f).filter(f => f !== id).slice(0, 200);
}
async function friendsBoard(db, id) {
  const ids = [id, ...await friendIds(db, id)];
  const rows = await db.prepare(`SELECT id, name, stars, night FROM players WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  const list = rows.results.sort((a, b) => b.stars - a.stars || b.night - a.night);
  return { board: 'friends', friends: ids.length - 1, top: list.map((r, i) => ({ rank: i + 1, name: r.name, value: r.stars, night: r.night, me: r.id === id })), me: null };
}
// a friend who was ahead and now is behind gets one note a day
async function tellPassedFriends(env, user, was, now) {
  const db = env.DB, ids = await friendIds(db, user.id);
  if (!ids.length) return;
  const rows = await db.prepare(`SELECT p.id, p.night, p.stars, n.lang, n.enabled, n.blocked, g.friend_day FROM players p
    LEFT JOIN notify n ON n.user_id = p.id LEFT JOIN pings g ON g.user_id = p.id WHERE p.id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  const today = utcDay(), name = displayName(user);
  if (!botName) { const me = await tg(env, 'getMe', {}); botName = me.ok ? me.result.username : null; }
  for (const f of rows.results) {
    if (f.enabled === 0 || f.blocked === 1 || f.friend_day === today) continue;
    const t = text(f.lang);
    let msg = null;
    if (was.night <= f.night && now.night > f.night) msg = t.passNight(name, now.night, f.night);
    else if (was.stars <= f.stars && now.stars > f.stars) msg = t.passStars(name, now.stars, f.stars);
    if (!msg) continue;
    await db.prepare('INSERT INTO pings (user_id, friend_day) VALUES (?1, ?2) ON CONFLICT(user_id) DO UPDATE SET friend_day = excluded.friend_day').bind(f.id, today).run();
    const r = await tg(env, 'sendMessage', { chat_id: f.id, text: msg,
      reply_markup: { inline_keyboard: [[{ text: t.friendsBtn, url: `https://t.me/${botName}?startapp=friends` }]] } });
    if (r.error_code === 403) await db.prepare('UPDATE notify SET blocked = 1 WHERE user_id = ?1').bind(f.id).run();
  }
}
// a ripe chest that has waited 2+ hours for a player who hasn't played for 8 hours: one note a day, in the afternoon
async function sendChestPings(env) {
  const db = env.DB;
  await ensureTables(db);
  const now = Math.floor(Date.now() / 1000), d = new Date(), today = utcDay();
  const rows = await db.prepare(`SELECT c.user_id, n.lang, n.tz FROM chests c JOIN notify n ON n.user_id = c.user_id
    WHERE c.ready_at <= ?1 AND n.last_seen < ?2 AND n.last_seen > ?3 AND n.enabled = 1 AND n.blocked = 0 AND (c.ping_day IS NULL OR c.ping_day <> ?4) LIMIT 300`)
    .bind(now - 2 * 3600, now - 8 * 3600, now - 3 * DAY / 1000, today).all();
  if (!rows.results.length) return;
  if (!botName) { const me = await tg(env, 'getMe', {}); botName = me.ok ? me.result.username : null; }
  for (const r of rows.results) {
    const hour = Math.floor(((d.getUTCHours() * 60 - r.tz) % 1440 + 1440) % 1440 / 60);
    if (hour < 12 || hour > 20) continue;
    await db.prepare('UPDATE chests SET ping_day = ?2 WHERE user_id = ?1').bind(r.user_id, today).run();
    const t = text(r.lang);
    try {
      const res = await tg(env, 'sendMessage', { chat_id: r.user_id, text: t.chestReady,
        reply_markup: { inline_keyboard: [[{ text: t.play, url: `https://t.me/${botName}?startapp=chest` }]] } });
      if (res.error_code === 403) await db.prepare('UPDATE notify SET blocked = 1 WHERE user_id = ?1').bind(r.user_id).run();
    } catch (e) {}
  }
}
// away 3 to 30 days: a small gift goes straight into the inventory, with a note; at most once a week
async function sendMissYou(env) {
  const db = env.DB;
  await ensureTables(db);
  const now = Math.floor(Date.now() / 1000), d = new Date(), wk = 7 * 24 * 3600;
  const rows = await db.prepare(`SELECT n.user_id, n.lang, n.tz FROM notify n LEFT JOIN comebacks b ON b.user_id = n.user_id
    WHERE n.last_seen < ?1 AND n.last_seen > ?2 AND n.enabled = 1 AND n.blocked = 0 AND (b.at IS NULL OR b.at < ?3) LIMIT 300`)
    .bind(now - 3 * 24 * 3600, now - 30 * 24 * 3600, now - wk).all();
  if (!rows.results.length) return;
  if (!botName) { const me = await tg(env, 'getMe', {}); botName = me.ok ? me.result.username : null; }
  for (const r of rows.results) {
    const hour = Math.floor(((d.getUTCHours() * 60 - r.tz) % 1440 + 1440) % 1440 / 60);
    if (hour < 12 || hour > 20) continue;
    await db.prepare('INSERT INTO comebacks (user_id, at) VALUES (?1, ?2) ON CONFLICT(user_id) DO UPDATE SET at = excluded.at').bind(r.user_id, now).run();
    const t = text(r.lang);
    try {
      const res = await tg(env, 'sendMessage', { chat_id: r.user_id, text: t.missYou,
        reply_markup: { inline_keyboard: [[{ text: t.play, url: `https://t.me/${botName}?startapp=back` }]] } });
      if (res.ok) await grant(db, r.user_id, MISS_GIFT);
      else if (res.error_code === 403) await db.prepare('UPDATE notify SET blocked = 1 WHERE user_id = ?1').bind(r.user_id).run();
    } catch (e) {}
  }
}
// evening reminder: a streak of 5+ days that will end at the next UTC day change unless the player opens the game
async function sendStreakReminders(env) {
  const db = env.DB;
  await ensureTables(db);
  const d = new Date(), left = 24 - d.getUTCHours(), today = utcDay(), yesterday = utcDay(Date.now() - DAY);
  if (left < 2 || left > 5) return;
  const rows = await db.prepare(`SELECT s.user_id, s.run, n.lang, n.tz FROM streaks s JOIN daily y ON y.user_id = s.user_id
    JOIN notify n ON n.user_id = s.user_id LEFT JOIN pings g ON g.user_id = s.user_id
    WHERE s.run >= 5 AND y.last_day = ?1 AND n.enabled = 1 AND n.blocked = 0 AND (g.streak_day IS NULL OR g.streak_day <> ?2) LIMIT 300`)
    .bind(yesterday, today).all();
  if (!rows.results.length) return;
  if (!botName) { const me = await tg(env, 'getMe', {}); botName = me.ok ? me.result.username : null; }
  for (const r of rows.results) {
    const hour = Math.floor(((d.getUTCHours() * 60 - r.tz) % 1440 + 1440) % 1440 / 60);
    if (hour < 9 || hour > 22) continue; // not at night
    await db.prepare('INSERT INTO pings (user_id, streak_day) VALUES (?1, ?2) ON CONFLICT(user_id) DO UPDATE SET streak_day = excluded.streak_day').bind(r.user_id, today).run();
    const t = text(r.lang);
    try {
      const res = await tg(env, 'sendMessage', { chat_id: r.user_id, text: t.streakEnds(r.run, left),
        reply_markup: { inline_keyboard: [[{ text: t.play, url: `https://t.me/${botName}?startapp=streak` }]] } });
      if (res.error_code === 403) await db.prepare('UPDATE notify SET blocked = 1 WHERE user_id = ?1').bind(r.user_id).run();
    } catch (e) {}
  }
}

// ---------- news channels: autoposting from the hourly cron ----------
// CHANNEL_UK / CHANNEL_EN (vars): the channels' @usernames; the bot has to be an admin there that may post.
// A channel stays quiet until the owner's /chan intro posts and pins the welcome post. Times are UTC. Monday 09:00: the week's results and the new weekly challenge; Tuesday, Thursday and
// Saturday 15:00: the next post of CH_FEED (room spotlights and tips, round and round); Friday 15:00: who
// leads the weekly challenge; the first day of a seasonal event: its announcement; three days before it ends, 15:00:
// a reminder with how many players already have its hat (<event>_end, the count from event_runs). Every post is claimed in
// channel_posts first, so a slot is posted once even if the cron overlaps.
// Play buttons carry startapp=ch_<lang>_<kind>; the first visit of a new player records it in `sources`,
// and the owner's /chan shows how many came from each.
const CH_LANGS = { uk: 'CHANNEL_UK', en: 'CHANNEL_EN' };
const CH_FEED_DAYS = [2, 4, 6], CH_HOUR = 15, CH_WEEK_HOUR = 9;
const CH_EVENTS = [{ id: 'halloween', from: '10-15', to: '11-05', room: 5 }, { id: 'newyear', from: '12-15', to: '01-10', room: 2 }];
// levels in an event (as EVENT_LEVELS in game.js); the "3 days left" post leaves the hat count out while it is under CH_EV_MIN
const EV_LEVELS = 3, CH_EV_END = 3, CH_EV_MIN = 10;
// the community group's announcement: once per channel, the first day it has CH_GROUP_AT subscribers (checked at CH_GROUP_HOUR)
const CH_GROUP_AT = 100, CH_GROUP_HOUR = 12;
const CH_TEXT = {
  uk: {
    mods: { wind: 'хуртовина', acid: 'кислота', meteors: 'метеорити', fences: 'лазерні бар\'єри', belts: 'конвеєрні стрічки' },
    bosses: ['блендер «Мегамікс»', 'Телебос 3000', 'Будильник-Дзвонар', 'пралька «Барабан»', 'повітродув «Шквал»', 'пилосос-привид', 'Робо-бос 9000', 'павук «Тенета»', 'дрон «Грім»', 'косарка «Стриж»', 'хаб «Розумний дім»', 'ліфт «Експрес»', 'сортувальник «Мегасклад»', 'збирач «Прайм»', 'професор «Колба»', 'командор «Орбіта»', 'снігоочисник «Завірюха»', 'кракен «Глибина»'],
    play: '🐾 Грати', medals: ['🥇', '🥈', '🥉'],
    weekHead: '📅 <b>Підсумки тижня в Pawsling</b>',
    night: rows => `🌙 <b>Турнір «Нічної зміни»</b>\n${rows.map((r, i) => `${CH_TEXT.uk.medals[i]} ${r.name} — ${r.night} ${ukWaves(r.night)}`).join('\n')}`,
    chalWon: (name, turns, n) => `⏱ <b>Випробування тижня</b>: найшвидше — ${name}, за ${turns} ход. (учасників: ${n})`,
    chalNew: (room, mods) => `🆕 <b>Нове випробування</b>: «${room}» + ${mods}. Той самий рівень для всіх — хто пройде за найменше ходів?`,
    chalLead: (room, mods, name, turns, n) => `⏱ <b>Випробування тижня</b>: «${room}» + ${mods}\n\nЗараз лідирує ${name} — ${turns} ход. Учасників: ${n}. До кінця тижня ще вихідні. Зможеш швидше?`,
    halloween: '🎃 <b>Хелловін у Pawsling!</b>\n\nРоботи вбралися в гарбузи: три святкові рівні з костюмованими ворогами, а за всі три — ексклюзивний капелюх-гарбуз. Подія триває до 5 листопада.',
    newyear: '🎄 <b>Новий рік у Pawsling!</b>\n\nТехніка в шапках Санти захопила спальню: три святкові рівні, а за всі три — ексклюзивна шапка Санти. Подія триває до 10 січня.',
    group: '💬 <b>У Pawsling тепер є спільнота!</b>\n\nОбговорюй рівні, ділися рекордами й скріншотами, питай поради в гілці 🇺🇦 UA. Щось не працює — пиши в 🛠 Technical Support, відповімо там.\n\nА в 📣 Events — події й підсумки тижня.',
    groupChat: '💬 Чат українською', groupSupport: '🛠 Підтримка',
    halloween_end: n => `🎃 <b>Хелловін: залишилося 3 дні!</b>\n\n${n ? `Капелюх-гарбуз уже є в ${n} ${ukPlayersGen(n)}. ` : ''}Три святкові рівні, а за всі три — ексклюзивний капелюх. Подія закінчується 5 листопада, і тоді капелюх не здобути аж до наступного року.`,
    newyear_end: n => `🎄 <b>Новий рік: залишилося 3 дні!</b>\n\n${n ? `Шапка Санти вже є в ${n} ${ukPlayersGen(n)}. ` : ''}Три святкові рівні, а за всі три — ексклюзивна шапка. Подія закінчується 10 січня, і тоді шапку не здобути аж до наступної зими.`,
    intro: '🐾 <b>Pawsling</b> — коти та єноти з рогатки проти збунтованої техніки.\n\n102 рівні, 18 босів, «Нічна зміна» з турніром щотижня — і все прямо в Telegram, без встановлення.\n\nТут: підсумки турнірів, випробування тижня, події, нові кімнати й поради.',
    room: (i, name, boss, what) => `🗺 <b>Кімната ${i + 1}: ${name}</b>\n\n${what}\n\nБос: <b>${boss}</b>.`,
    rooms: [
      'Тут усе почалося: пилососи збунтувалися просто біля холодильника. Порада новачкам: бий у жовтий сенсор — потрійна шкода.',
      'Телевізор оголосив себе королем дивана й скликав пульти та пилососи.',
      'Навіть будильник перейшов на бік роботів. Тепер ніхто не виспиться, доки його не вимкнуть.',
      'Тут слизько, мильно й гамірно, а вороги стають міцнішими.',
      'Свіже повітря й зовсім не свіжі роботи. Перша кімната з шістьма рівнями.',
      'Темно, пильно й моторошно: на горищі завівся привид… пилососа.',
      'Щитоботи ріжуть шкоду сусідам до 35%, а близнюки після удару діляться на двох малюків. Спершу знімай щит!',
      'Тут змішалися всі вороги одразу. Бос після кожної атаки обплутує героя павутиною — той пропускає хід, доки друг його не звільнить пострілом.',
      'Магніти притягують героїв і гнуть постріли. Блискавка боса перескакує на найближчого героя — тримай команду врозтіч.',
      'Кроти через хід ховаються під землю, і постріли котяться над ними. Бос після атаки таранить героя й розштовхує всіх на шляху.',
      '3D-принтери друкують міні-роботів після кожної атаки. Бос розганяє всіх інших роботів, і ті б\'ють на хід раніше.',
      'Бомбоботи вибухають, коли їх збити, і зачіпають сусідів — можна влаштувати ланцюжок. Бос б\'є вниз по шахті: усі під ним втрачають серце.',
      'Конвеєрні стрічки зносять героїв у польоті, а коробоботи ховаються в коробку. Бос після атаки розвертає стрічки й пришвидшує їх.',
      'Лазерні бар\'єри вмикаються через хід і відбивають героїв, як стіни, а турелі стріляють уздовж усього ряду. Бос відбудовує останнього збитого робота.',
      'Калюжі кислоти забирають серце в того, хто в них стоїть, а тесла-боти б\'ють струмом усіх поруч. Бос розливає нову калюжу під героєм.',
      'Метеорити падають туди, де за хід до того з\'явилися мітки. Варп-боти телепортуються після кожного влучання. Бос наводить метеорити просто на героїв.',
      'Хуртовина щоходу дме з нового боку, а кріоботи заморожують героїв. Бос змітає всю команду туди, куди дме вітер.',
      'Найважча кімната: вода щоходу піднімається знизу й гальмує героїв у польоті. Медузоботи заряджаються за хід до атаки, і герой, що влучить у зарядженого, зупиняється на місці. Бос після кожної атаки здіймає воду одразу на три поділки. Це фінал гри: рівень 102.',
    ],
    tips: {
      slingshot: '🎯 <b>Як грати</b>\n\nТягни героя назад, цілься й відпускай. Герої відбиваються від стін і прошивають роботів наскрізь — найкращі постріли зачіпають кількох одразу.',
      knots: '🧶 <b>Вузли</b>\n\nПерехрести нитки двох пострілів — і на перетині зав\'яжеться вузол, що вибухає. Кіт + єнот = вогняний вузол (×1,5 шкоди), два коти — муркотливий (ширший), два єноти — сміттєвий (відкладає атаку роботів на хід).',
      bosses: '👾 <b>18 босів</b>\n\nУ кожної кімнати свій бос зі своїм трюком: павутина, ланцюгова блискавка, кислотні калюжі, метеорити, хуртовина, приплив… Хто з них дався тобі найважче?',
      map: '🗺 <b>102 рівні у 18 кімнатах</b>\n\nВід кухні до підводної бази. Три зірки — якщо вкладешся в норму ходів, а пройдений рівень можна переграти в режимі виклику: вороги на 40% міцніші, зате подвійний досвід і корона на карті.',
      heroes: '🐱 <b>Герої ростуть</b>\n\nЗа кожну перемогу герої отримують досвід: до 10 рівня, +4% шкоди за рівень і посилення здібності на 5-му і 10-му. Хом\'як Хеммі приєднується після 24 рівня — що далі котиться, то сильніше б\'є.',
      night: '🌙 <b>«Нічна зміна»</b>\n\nНескінченні хвилі, бос кожну п\'яту, кімната міняється кожні п\'ять хвиль. Щопонеділка топ-3 тижня отримують призи — а ми публікуємо їхні імена тут.',
      chest: '🎁 <b>Скриня</b>\n\nСкриня на нижній панелі карти дозріває кожні 6 годин: серце, швидкий старт, а інколи й безкоштовне друге дихання. Не забувай забирати!',
      invite: '📨 <b>Грати разом веселіше</b>\n\nЗапроси друга: коли він зайде в гру за твоїм посиланням, ви обидва отримаєте +1 серце і +1 швидкий старт. А в рейтингу друзів видно, хто кого обганяє.',
      album: '🏅 <b>Альбом роботів</b>\n\nКожна перемога над роботом іде в альбом. 10, 50 і 200 перемог роблять картку бронзовою, срібною й золотою — і за кожну дають подарунок.',
      quests: '📋 <b>Квести тижня</b>\n\nНа екрані «Щодня» щотижня три нові цілі: вузли, боси, рівні на три зірки… За кожну — бонус, а за всі три — безкоштовне друге дихання.',
      streak: '🔥 <b>Серія днів</b>\n\nЗаходь щодня: бонус за вхід росте сім днів поспіль, а кожні 30 днів поспіль — святковий капелюх для всієї команди.',
      raids: '🚨 <b>Нальоти</b>\n\nІнколи роботи нападають на одну з кімнат, і бот кличе на допомогу. Відбий нальот за 30 хвилин — і отримаєш серце та швидкий старт.',
    },
  },
  en: {
    mods: { wind: 'blizzard', acid: 'acid', meteors: 'meteors', fences: 'laser fences', belts: 'conveyor belts' },
    bosses: ['Megamix Blender', 'Teleboss 3000', 'Bellringer Alarm', 'Drum Washer', 'Gale Blower', 'Ghost Vacuum', 'Robo-Boss 9000', 'Web-Spinner', 'Thunder Drone', 'Swift Mower', 'Smart Home Hub', 'Express Lift', 'Mega Sorter', 'Assembler Prime', 'Professor Flask', 'Commander Orbit', 'Blizzard Snowplough', 'Kraken Deep'],
    play: '🐾 Play', medals: ['🥇', '🥈', '🥉'],
    weekHead: '📅 <b>The week in Pawsling</b>',
    night: rows => `🌙 <b>Night Shift tournament</b>\n${rows.map((r, i) => `${CH_TEXT.en.medals[i]} ${r.name} — ${r.night} waves`).join('\n')}`,
    chalWon: (name, turns, n) => `⏱ <b>Weekly challenge</b>: fastest was ${name}, in ${turns} turns (${n} players)`,
    chalNew: (room, mods) => `🆕 <b>New challenge</b>: ${room} + ${mods}. The same level for everyone: who can win it in the fewest turns?`,
    chalLead: (room, mods, name, turns, n) => `⏱ <b>Weekly challenge</b>: ${room} + ${mods}\n\n${name} leads with ${turns} turns. Players so far: ${n}. There is still the weekend. Can you do it faster?`,
    halloween: '🎃 <b>Halloween in Pawsling!</b>\n\nThe robots dressed up as pumpkins: three spooky levels with costumed enemies, and an exclusive pumpkin hat for beating all three. On until 5 November.',
    newyear: '🎄 <b>New Year in Pawsling!</b>\n\nGadgets in Santa hats took over the bedroom: three festive levels, and an exclusive Santa hat for beating all three. On until 10 January.',
    group: '💬 <b>Pawsling has a community now!</b>\n\nTalk about levels, share records and screenshots, and ask for tips in the 🇬🇧 EN topic. Something broken? Write in 🛠 Technical Support and we\'ll answer there.\n\nAnd 📣 Events has the events and the weekly results.',
    groupChat: '💬 English chat', groupSupport: '🛠 Support',
    halloween_end: n => `🎃 <b>Halloween: 3 days left!</b>\n\n${n ? `${n} players already have the pumpkin hat. ` : ''}Three spooky levels, and the exclusive hat for beating all three. The event ends on 5 November, and then the hat is gone until next year.`,
    newyear_end: n => `🎄 <b>New Year: 3 days left!</b>\n\n${n ? `${n} players already have the Santa hat. ` : ''}Three festive levels, and the exclusive hat for beating all three. The event ends on 10 January, and then the hat is gone until next winter.`,
    intro: '🐾 <b>Pawsling</b>: slingshot cats and raccoons against rebel household robots.\n\n102 levels, 18 bosses, a weekly Night Shift tournament, all right inside Telegram with nothing to install.\n\nHere: tournament results, the weekly challenge, events, new rooms and tips.',
    room: (i, name, boss, what) => `🗺 <b>Room ${i + 1}: ${name}</b>\n\n${what}\n\nBoss: <b>${boss}</b>.`,
    rooms: [
      'Where it all began: the vacuums rebelled right by the fridge. A tip for beginners: hit the yellow sensor for triple damage.',
      'The TV declared itself king of the sofa and called in the remotes and vacuums.',
      'Even the alarm clock switched sides. Nobody sleeps until it is switched off.',
      'Slippery, soapy and loud, and the enemies keep getting tougher.',
      'Fresh air and not-so-fresh robots. The first room with six levels.',
      'Dark, dusty and creepy: the attic is haunted by a ghost… of a vacuum.',
      'Shield bots cut damage to their neighbours to 35%, and twins split into two minis when hit. Take the shield down first!',
      'Every enemy type at once. After each attack the boss webs a hero, who skips a turn unless a friend shoots them free.',
      'Magnets pull heroes in and bend their shots. The boss\'s lightning jumps to the closest hero, so keep the team spread out.',
      'Moles dig underground every other turn, and shots roll right over them. The boss charges at the hero it hit and shoves everyone aside.',
      '3D printers print a mini robot after every attack. The boss overclocks every other robot, so they strike a turn sooner.',
      'Bomb bots explode when destroyed and hurt the robots nearby: chain them! The boss strikes down its shaft, and every hero below loses a heart.',
      'Conveyor belts push flying heroes sideways and box bots hide in a box. After each attack the boss reverses every belt and speeds it up.',
      'Laser fences switch on every other turn and bounce heroes like walls; turrets fire along their whole row. The boss rebuilds the last robot you broke.',
      'Acid pools take a heart from anyone standing in them, and tesla bots zap every hero nearby. The boss spills a new pool under a hero.',
      'Meteors land where markers appeared a turn before. Warp bots blink away after every hit. The boss aims meteors right at your heroes.',
      'The blizzard blows from a new side every turn and cryo bots freeze heroes. The boss sweeps the whole team the way the wind blows.',
      'The hardest room: the water rises from the bottom every turn and slows heroes flying through it. Jelly bots charge up the turn before they attack, and a hero that hits a charged one stops dead. After each attack the boss raises the water three marks at once. This is the finale of the game: level 102.',
    ],
    tips: {
      slingshot: '🎯 <b>How to play</b>\n\nPull a hero back, aim and let go. Heroes bounce off walls and pierce right through robots: the best shots hit several at once.',
      knots: '🧶 <b>Knots</b>\n\nCross the threads of two shots and a knot ties where they meet, then explodes. Cat + raccoon is a fire knot (×1.5 damage), two cats a purring knot (wider), two raccoons a trash knot (delays the robots\' attack by a turn).',
      bosses: '👾 <b>18 bosses</b>\n\nEvery room has its own boss with its own trick: webs, chain lightning, acid pools, meteors, a blizzard, the tide… Which one gave you the hardest time?',
      map: '🗺 <b>102 levels in 18 rooms</b>\n\nFrom the kitchen to the underwater base. Three stars if you win within the par, and a won level can be replayed in challenge mode: enemies 40% tougher, but double XP and a crown on the map.',
      heroes: '🐱 <b>Heroes grow</b>\n\nEvery win gives XP: up to level 10, +4% damage per level and an ability upgrade at 5 and 10. Hammy the hamster joins after level 24: the further he rolls, the harder he hits.',
      night: '🌙 <b>Night Shift</b>\n\nEndless waves, a boss every fifth, a new room every five waves. Every Monday the week\'s top 3 get prizes, and we post their names here.',
      chest: '🎁 <b>The chest</b>\n\nThe chest on the map\'s bottom bar ripens every 6 hours: a heart, a quick start, and now and then a free Second wind. Don\'t forget to grab it!',
      invite: '📨 <b>Better together</b>\n\nInvite a friend: when they join through your link, you both get +1 heart and +1 quick start. The friends board shows who is ahead of whom.',
      album: '🏅 <b>Robot album</b>\n\nEvery win over a robot goes into the album. 10, 50 and 200 wins make its card bronze, silver and gold, with a gift for each.',
      quests: '📋 <b>Weekly quests</b>\n\nThree new goals every week on the Daily screen: knots, bosses, 3-star wins… A bonus for each, and a free Second wind for all three.',
      streak: '🔥 <b>Login streak</b>\n\nCome back every day: the login bonus grows for seven days in a row, and every 30 days in a row brings a party hat for the whole team.',
      raids: '🚨 <b>Raids</b>\n\nNow and then robots raid one of the rooms and the bot calls for help. Repel the raid within 30 minutes for a heart and a quick start.',
    },
  },
};
// the feed alternates tips and room spotlights; img is a path under ART, or a function of the language
const shot = n => l => `${l}/${n}.jpg`;
// pictures drawn for the feed, without text, so both channels share them
const feed = n => `feed/${n}-1280x720.jpg`;
const CH_FEED = [
  { tip: 'slingshot', img: shot('1-slingshot') }, { room: 0 }, { tip: 'knots', img: shot('2-knots') }, { room: 1 },
  { tip: 'chest', img: feed('chest') }, { room: 2 }, { tip: 'map', img: shot('4-map') }, { room: 3 },
  { tip: 'invite', img: feed('invite') }, { room: 4 }, { tip: 'heroes', img: shot('5-heroes') }, { room: 5 },
  { tip: 'night', img: shot('6-night') }, { room: 6 }, { tip: 'quests', img: feed('quests') }, { room: 7 },
  { tip: 'bosses', img: shot('3-bosses') }, { room: 8 }, { tip: 'raids', img: 'raid/raid-8.jpg' }, { room: 9 },
  { tip: 'album', img: feed('album') }, { room: 10 }, { tip: 'streak', img: feed('streak') }, { room: 11 },
  { room: 12 }, { room: 13 }, { room: 14 }, { room: 15 }, { room: 16 }, { room: 17 },
];
const ukWaves = n => n % 10 === 1 && n % 100 !== 11 ? 'хвиля' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'хвилі' : 'хвиль';
const ukPlayersGen = n => n % 10 === 1 && n % 100 !== 11 ? 'гравця' : 'гравців'; // "у 21 гравця", "у 25 гравців"
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
// the same weekly challenge as weekChallenge() in game.js: CHAL_ROOMS = CHAPTERS.length there, from the balcony on
// (raids use ROOMS_N, which only grows once a room's raid poster is up)
const CHAL_ROOMS = 18;
function chalOf(wk) {
  const h = [...wk].reduce((a, c) => (a * 37 + c.charCodeAt(0)) % 2147483646, 11) + 1;
  let s = h; const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const room = 4 + Math.floor(R() * (CHAL_ROOMS - 4)), mods = ['wind', 'acid', 'meteors', 'fences', 'belts'];
  for (let i = mods.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [mods[i], mods[j]] = [mods[j], mods[i]]; }
  return { room, mods: mods.slice(0, 2) };
}
const modList = (c, l) => c.mods.map(m => CH_TEXT[l].mods[m]).join(l === 'uk' ? ' і ' : ' and ');
function channels(env) {
  return Object.entries(CH_LANGS).map(([lang, k]) => ({ lang, chat: chatRef(env[k]) })).filter(c => c.chat);
}
// a channel or group from the config: @username (the @ may be left out) or a numeric -100… id
const chatRef = v => { const c = String(v || '').trim().replace(/^https:\/\/t\.me\//, ''); return !c || c.startsWith('@') || /^-?\d+$/.test(c) ? c : '@' + c; };
const channelUrl = chat => chat.startsWith('@') ? `https://t.me/${chat.slice(1)}` : null;
async function ensureBotName(env) {
  if (!botName) { const me = await tg(env, 'getMe', {}); botName = me.ok ? me.result.username : null; }
  return botName;
}
// a post: { img, caption } for a language, or null when there is nothing to say
async function channelPost(env, kind, lang, now = Date.now()) {
  const t = CH_TEXT[lang], rooms = TEXT[lang].rooms, db = env.DB;
  if (kind === 'week') {
    const last = weekKey(now - 3 * DAY), c = chalOf(weekKey(now)), parts = [t.weekHead];
    const top = await db.prepare('SELECT name, night FROM weekly WHERE week = ?1 AND night > 0 ORDER BY night DESC, at ASC LIMIT 3').bind(last).all();
    if (top.results.length) parts.push(t.night(top.results.map(r => ({ name: esc(r.name), night: r.night }))));
    const best = await db.prepare('SELECT name, turns FROM chal WHERE week = ?1 ORDER BY turns ASC, at ASC LIMIT 1').bind(last).first();
    if (best) {
      const n = await db.prepare('SELECT COUNT(*) AS n FROM chal WHERE week = ?1').bind(last).first();
      parts.push(t.chalWon(esc(best.name), best.turns, n.n));
    }
    parts.push(t.chalNew(rooms[c.room], modList(c, lang)));
    return { img: `raid/raid-${c.room}.jpg`, caption: parts.join('\n\n') };
  }
  if (kind === 'chal') {
    const wk = weekKey(now), c = chalOf(wk);
    const best = await db.prepare('SELECT name, turns FROM chal WHERE week = ?1 ORDER BY turns ASC, at ASC LIMIT 1').bind(wk).first();
    if (!best) return null;
    const n = await db.prepare('SELECT COUNT(*) AS n FROM chal WHERE week = ?1').bind(wk).first();
    return { img: `raid/raid-${c.room}.jpg`, caption: t.chalLead(rooms[c.room], modList(c, lang), esc(best.name), best.turns, n.n) };
  }
  if (kind === 'intro') return { img: 'welcome-1280x720.jpg', caption: t.intro };
  if (kind === 'group') {
    // buttons straight into the topic of the channel's language and into support (needs a public group)
    const chatUrl = await groupTopicUrl(env, lang), helpUrl = await groupTopicUrl(env, 'support');
    if (!chatUrl || !helpUrl) return null;
    return { img: feed('invite'), caption: t.group, kb: [[{ text: t.groupChat, url: chatUrl }], [{ text: t.groupSupport, url: helpUrl }]] };
  }
  const ev = CH_EVENTS.find(e => e.id === kind);
  if (ev) return { img: `raid/raid-${ev.room}.jpg`, caption: t[ev.id] };
  const end = CH_EVENTS.find(e => e.id + '_end' === kind);
  if (end) {
    const hats = await db.prepare('SELECT COUNT(*) AS n FROM event_runs WHERE ev_key = ?1 AND levels >= ?2').bind(evRunKey(end, now), EV_LEVELS).first();
    return { img: `raid/raid-${end.room}.jpg`, caption: t[kind](hats.n >= CH_EV_MIN ? hats.n : 0) };
  }
  const m = /^feed(\d+)$/.exec(kind);
  if (m) {
    const f = CH_FEED[Number(m[1]) % CH_FEED.length];
    if (f.tip) return { img: typeof f.img === 'function' ? f.img(lang) : f.img, caption: t.tips[f.tip] };
    return { img: `raid/raid-${f.room}.jpg`, caption: t.room(f.room, rooms[f.room], t.bosses[f.room], t.rooms[f.room]) };
  }
  return null;
}
async function sendChannelPost(env, chat, lang, kind, post, thread = null, via = 'ch') {
  const src = `${via}_${lang}_${kind.replace(/\d+$/, '')}`;
  return tg(env, 'sendPhoto', { chat_id: chat, photo: ART + post.img, caption: post.caption, parse_mode: 'HTML', ...(thread ? { message_thread_id: thread } : {}),
    reply_markup: { inline_keyboard: post.kb || [[{ text: CH_TEXT[lang].play, url: `https://t.me/${botName}?startapp=${src}` }]] } });
}
// the group's announcement is due once the channel has grown to CH_GROUP_AT subscribers (and the group has its topics)
async function groupPostDue(env, chat, ts = Date.now()) {
  if (new Date(ts).getUTCHours() !== CH_GROUP_HOUR || !await groupTopic(env, 'support')) return false;
  if (await env.DB.prepare("SELECT 1 AS x FROM channel_posts WHERE chat = ?1 AND key = 'group'").bind(chat).first()) return false;
  const n = await tg(env, 'getChatMemberCount', { chat_id: chat });
  return n.ok && n.result >= CH_GROUP_AT;
}
// an event's run is keyed by the year it started (New Year runs over the change of year), as evKey() in game.js
function evRunKey(e, ts = Date.now()) {
  const md = utcDay(ts).slice(5), y = new Date(ts).getUTCFullYear();
  return `${e.id}-${e.from > e.to && md <= e.to ? y - 1 : y}`;
}
// the event running on this day, with the key of this year's run; ending: today is CH_EV_END days before its last day
function eventToday(ts = Date.now()) {
  const md = utcDay(ts).slice(5);
  for (const e of CH_EVENTS) {
    const inside = e.from <= e.to ? md >= e.from && md <= e.to : md >= e.from || md <= e.to;
    if (inside) return { id: e.id, key: evRunKey(e, ts), ending: utcDay(ts + CH_EV_END * DAY).slice(5) === e.to };
  }
  return null;
}
// what is due this hour: [{ key, kind }], key being unique per slot
async function channelDue(db, chat, ts = Date.now()) {
  const d = new Date(ts), h = d.getUTCHours(), wd = d.getUTCDay(), day = utcDay(ts), due = [];
  if (wd === 1 && h === CH_WEEK_HOUR) due.push({ key: 'week-' + weekKey(ts), kind: 'week' });
  if (wd === 5 && h === CH_HOUR) due.push({ key: 'chal-' + weekKey(ts), kind: 'chal' });
  const ev = eventToday(ts);
  if (ev && h >= CH_WEEK_HOUR && h <= CH_HOUR) due.push({ key: 'ev-' + ev.key, kind: ev.id });
  // from 15:00 on, so a missed cron hour still posts it that day
  if (ev && ev.ending && h >= CH_HOUR) due.push({ key: 'evend-' + ev.key, kind: ev.id + '_end' });
  if (CH_FEED_DAYS.includes(wd) && h === CH_HOUR) {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM channel_posts WHERE chat = ?1 AND key LIKE 'feed-%'").bind(chat).first();
    due.push({ key: 'feed-' + day, kind: 'feed' + n.n });
  }
  return due;
}
async function sendChannelPosts(env) {
  const list = channels(env);
  if (!list.length && !groupChat(env)) return;
  const db = env.DB;
  await ensureTables(db);
  await ensureBotName(env);
  const now = Math.floor(Date.now() / 1000), targets = [];
  // a channel goes live with its welcome post (/chan intro), so nothing lands in it before that
  for (const c of list) if (await db.prepare("SELECT 1 AS x FROM channel_posts WHERE chat = ?1 AND key LIKE 'intro-%'").bind(c.chat).first()) targets.push(c);
  // the group's Events topic (live once /chan group made it) gets the week's results and events, in both languages
  const ev = await groupTopic(env, 'events');
  if (ev) for (const lang of Object.keys(CH_LANGS)) targets.push({ lang, chat: ev.chat, thread: ev.thread, via: 'grp', only: k => k === 'week' || CH_EVENTS.some(e => k === e.id || k === e.id + '_end') });
  for (const { lang, chat, thread, via, only } of targets) {
    const due = await channelDue(db, chat);
    if (!thread && await groupPostDue(env, chat)) due.push({ key: 'group', kind: 'group' });
    for (let { key, kind } of due) {
      if (only && !only(kind)) continue;
      if (thread) key += '-' + lang;
      // claim the slot first; give it back if the post could not go out
      const claim = await db.prepare('INSERT OR IGNORE INTO channel_posts (chat, key, at) VALUES (?1, ?2, ?3)').bind(chat, key, now).run();
      if (claim.meta.changes === 0) continue;
      let r;
      try {
        const post = await channelPost(env, kind, lang);
        if (!post) continue; // nothing to say (no challenge results yet): the slot stays used
        r = await sendChannelPost(env, chat, lang, kind, post, thread, via);
      } catch (e) { r = { ok: false, description: String(e) }; }
      if (r.ok) await db.prepare('UPDATE channel_posts SET msg_id = ?3 WHERE chat = ?1 AND key = ?2').bind(chat, key, r.result.message_id).run();
      else {
        await db.prepare('DELETE FROM channel_posts WHERE chat = ?1 AND key = ?2').bind(chat, key).run();
        await notifyAdmin(env, `⚠️ Канал ${chat}: не вдалося опублікувати ${key}: ${r.description || ''}`);
      }
    }
  }
}
// ---------- community group: a forum with topics ----------
// COMMUNITY_GROUP (var): the group's @username (or -100… id). The owner turns Topics on in the group settings and
// makes the bot an admin with "Manage topics"; /chan group then creates the topics below with a first message
// in each, closes Events (only admins and the bot write there; reactions stay) and hides General.
const GROUP_TOPICS = [
  { key: 'uk', name: '🇺🇦 UA', color: 16766590 }, { key: 'en', name: '🇬🇧 EN', color: 7322096 },
  { key: 'support', name: '🛠 Technical Support', color: 16478047 }, { key: 'events', name: '📣 Events', color: 13338331, closed: true },
];
const GROUP_HELLO = {
  uk: '🇺🇦 Тут спілкуємося українською: питання, поради, рекорди й скріншоти. Будьмо чемними 🐾',
  en: '🇬🇧 English chat: questions, tips, records and screenshots. Be kind 🐾',
  support: '🛠 Щось не працює? Напиши тут: що сталося, на якому рівні, телефон чи комп\'ютер. Скріншот дуже допоможе.\n\nSomething broken? Tell us here: what happened, which level, phone or computer. A screenshot helps a lot.',
  events: '📣 Події, підсумки тижня й анонси. Писати тут можуть лише адміни, а обговорити все можна в гілках UA та EN.\n\nEvents, weekly results and news. Only admins post here; talk about it in the UA and EN topics.',
};
const groupChat = env => chatRef(env.COMMUNITY_GROUP);
async function groupTopic(env, key) {
  const chat = groupChat(env);
  if (!chat) return null;
  const row = await env.DB.prepare('SELECT thread_id FROM group_topics WHERE chat = ?1 AND key = ?2').bind(chat, key).first();
  return row ? { chat, thread: row.thread_id } : null;
}
// a link straight into a topic (needs a public group)
async function groupTopicUrl(env, key) {
  const t = await groupTopic(env, key), base = t && channelUrl(t.chat);
  return base ? `${base}/${t.thread}` : null;
}
async function groupSetup(env) {
  const db = env.DB, chat = groupChat(env), out = [`💬 Група ${chat}`];
  const info = await tg(env, 'getChat', { chat_id: chat });
  if (!info.ok) return `⚠️ Група ${chat}: ${info.description || 'недоступна'} (бот доданий у групу адміном?)`;
  if (!info.result.is_forum) return `⚠️ У групі ${chat} не ввімкнені гілки: Налаштування групи → Topics / Гілки. Потім /chan group ще раз.`;
  for (const t of GROUP_TOPICS) {
    if (await groupTopic(env, t.key)) { out.push(`${t.name}: вже є`); continue; }
    const r = await tg(env, 'createForumTopic', { chat_id: chat, name: t.name, icon_color: t.color });
    if (!r.ok) { out.push(`${t.name}: ⚠️ ${r.description || 'помилка'} (бот має право «Керувати гілками»?)`); continue; }
    const thread = r.result.message_thread_id;
    await db.prepare('INSERT OR REPLACE INTO group_topics (chat, key, thread_id) VALUES (?1, ?2, ?3)').bind(chat, t.key, thread).run();
    await tg(env, 'sendMessage', { chat_id: chat, message_thread_id: thread, text: GROUP_HELLO[t.key] });
    const c = t.closed ? await tg(env, 'closeForumTopic', { chat_id: chat, message_thread_id: thread }) : null;
    out.push(`${t.name}: ✅ створено${c ? (c.ok ? ', закрито для учасників' : ` ⚠️ не вдалося закрити: ${c.description || ''}`) : ''}`);
  }
  const h = await tg(env, 'hideGeneralForumTopic', { chat_id: chat });
  out.push(h.ok ? 'General: сховано' : `General: ${h.description || 'не сховано'}`);
  out.push('\nЯкщо видалиш гілку руками, /chan group reset забуде збережені гілки, і /chan group створить їх знову.');
  return out.join('\n');
}
// the owner's /chan: status and arrivals; /chan preview: every kind of post sent to the owner;
// /chan intro: the welcome post, posted and pinned in every channel; /chan post <week|chal|feed|halloween|newyear|halloween_end|newyear_end>: post now
async function channelCommand(env, m) {
  const db = env.DB, list = channels(env), arg = m.text.trim().split(/\s+/).slice(1), say = s => tg(env, 'sendMessage', { chat_id: m.chat.id, text: s });
  await ensureTables(db);
  await ensureBotName(env);
  if (arg[0] === 'group') {
    if (!groupChat(env)) return say('Група не налаштована: додай COMMUNITY_GROUP у wrangler.toml ([vars]) і зроби деплой.');
    if (arg[1] === 'reset') { await db.prepare('DELETE FROM group_topics WHERE chat = ?1').bind(groupChat(env)).run(); return say('Збережені гілки забуто. /chan group створить нові.'); }
    return say(await groupSetup(env));
  }
  if (!list.length && !groupChat(env)) return say('Канали не налаштовані: додай CHANNEL_UK і CHANNEL_EN (і COMMUNITY_GROUP для групи) у wrangler.toml ([vars]) і зроби деплой.');
  if (arg[0] === 'preview') {
    for (const { lang } of list) {
      const n = await db.prepare("SELECT COUNT(*) AS n FROM channel_posts WHERE chat = ?1 AND key LIKE 'feed-%'").bind(list.find(c => c.lang === lang).chat).first();
      for (const kind of ['intro', 'week', 'chal', 'feed' + n.n, 'halloween', 'halloween_end', 'group']) {
        const post = await channelPost(env, kind, lang);
        if (!post) { await say(`${lang} · ${kind}: зараз нема що публікувати`); continue; }
        const r = await sendChannelPost(env, m.chat.id, lang, kind, post);
        if (!r.ok) await say(`${lang} · ${kind}: ${r.description || 'помилка'}`);
      }
    }
    return;
  }
  if (arg[0] === 'intro' || arg[0] === 'post') {
    const kind = arg[0] === 'intro' ? 'intro' : arg[1];
    if (!['intro', 'week', 'chal', 'feed', 'halloween', 'newyear', 'halloween_end', 'newyear_end', 'group'].includes(kind)) return say('Що саме? /chan post group | week | chal | feed | halloween | newyear | halloween_end | newyear_end');
    const out = [];
    for (const { lang, chat } of list) {
      let k = kind, key = null;
      if (kind === 'feed') {
        const n = await db.prepare("SELECT COUNT(*) AS n FROM channel_posts WHERE chat = ?1 AND key LIKE 'feed-%'").bind(chat).first();
        k = 'feed' + n.n; key = `feed-manual-${Date.now()}`; // counts as a feed post, so the rotation moves on
      }
      if (kind === 'intro') key = `intro-${Date.now()}`; // the channel is live from now on
      if (kind === 'group') key = 'group'; // posted by hand: the automatic one is then skipped
      const post = await channelPost(env, k, lang);
      if (!post) { out.push(`${chat}: нема що публікувати`); continue; }
      const r = await sendChannelPost(env, chat, lang, k, post);
      if (r.ok && key) await db.prepare('INSERT OR IGNORE INTO channel_posts (chat, key, at, msg_id) VALUES (?1, ?2, ?3, ?4)').bind(chat, key, Math.floor(Date.now() / 1000), r.result.message_id).run();
      if (r.ok && kind === 'intro') await tg(env, 'pinChatMessage', { chat_id: chat, message_id: r.result.message_id, disable_notification: true });
      out.push(`${chat}: ${r.ok ? '✅' : '⚠️ ' + (r.description || '')}`);
    }
    return say(out.join('\n'));
  }
  const me = await tg(env, 'getMe', {}), lines = ['📣 Канали'];
  for (const { lang, chat } of list) {
    const cm = me.ok ? await tg(env, 'getChatMember', { chat_id: chat, user_id: me.result.id }) : { ok: false };
    const can = cm.ok && (cm.result.status === 'creator' || (cm.result.status === 'administrator' && cm.result.can_post_messages !== false));
    const subs = await tg(env, 'getChatMemberCount', { chat_id: chat });
    const posts = await db.prepare('SELECT COUNT(*) AS n, MAX(at) AS last FROM channel_posts WHERE chat = ?1 AND msg_id IS NOT NULL').bind(chat).first();
    lines.push(`\n${chat} (${lang}): ${can ? '✅ бот може публікувати' : '⚠️ бот не адмін або не може публікувати'}` +
      `\nпідписників: ${subs.ok ? subs.result : '?'} · постів: ${posts.n}${posts.last ? ` · останній ${new Date(posts.last * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}`);
  }
  const gchat = groupChat(env);
  if (gchat) {
    const gi = await tg(env, 'getChat', { chat_id: gchat }), cm = me.ok ? await tg(env, 'getChatMember', { chat_id: gchat, user_id: me.result.id }) : { ok: false };
    const n = await tg(env, 'getChatMemberCount', { chat_id: gchat });
    const topics = (await db.prepare('SELECT key FROM group_topics WHERE chat = ?1').bind(gchat).all()).results.map(r => r.key);
    const canTopics = cm.ok && (cm.result.status === 'creator' || (cm.result.status === 'administrator' && cm.result.can_manage_topics));
    lines.push(`\n💬 ${gchat}: ${!gi.ok ? '⚠️ недоступна' : gi.result.is_forum ? 'гілки ввімкнені' : '⚠️ гілки вимкнені'} · ${canTopics ? '✅ бот керує гілками' : '⚠️ бот без права «Керувати гілками»'}` +
      `\nучасників: ${n.ok ? n.result : '?'} · гілки: ${topics.length ? topics.join(', ') : 'ще не створені (/chan group)'}`);
  }
  // new players by where they came from
  const day = Math.floor(Date.now() / 1000) - 86400;
  const rows = await db.prepare(`SELECT src, COUNT(*) AS n, SUM(at > ?1) AS d1, SUM(at > ?2) AS d7 FROM sources
    GROUP BY src ORDER BY n DESC LIMIT 15`).bind(day, day - 6 * 86400).all();
  lines.push('\nНові гравці за джерелом (доба / 7 днів / усього):');
  lines.push(rows.results.length ? rows.results.map(r => `${r.src}: ${r.d1} / ${r.d7} / ${r.n}`).join('\n') : 'поки нікого');
  lines.push('\n/chan preview — усі види постів мені\n/chan intro — привітальний пост у канали і закріпити\n/chan post group|week|chal|feed|halloween|newyear|halloween_end|newyear_end — опублікувати зараз\n/chan group — створити гілки в групі');
  return say(lines.join('\n'));
}

async function board(db, col, id) {
  // `col` is one of two fixed names checked by the caller, never user text
  const top = await db.prepare(
    `SELECT id, name, ${col} AS value FROM players WHERE ${col} > 0 ORDER BY ${col} DESC, ${col}_at ASC LIMIT ${TOP}`,
  ).all();
  const me = await db.prepare(`SELECT ${col} AS value, ${col}_at AS at FROM players WHERE id = ?1`).bind(id).first();
  let mine = null;
  if (me && me.value > 0) {
    const ahead = await db.prepare(
      `SELECT COUNT(*) AS n FROM players WHERE ${col} > ?1 OR (${col} = ?1 AND ${col}_at < ?2)`,
    ).bind(me.value, me.at).first();
    mine = { rank: ahead.n + 1, value: me.value };
  }
  return {
    board: col,
    top: top.results.map((r, i) => ({ rank: i + 1, name: r.name, value: r.value, me: r.id === id })),
    me: mine,
  };
}

// ---------- Telegram initData check (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app) ----------
const enc = new TextEncoder();
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
function sameString(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function verify(initData, token) {
  if (typeof initData !== 'string' || !initData || !token) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac('WebAppData', token);
  if (!sameString(hex(await hmac(secret, check)), hash)) return null;
  const age = Date.now() / 1000 - Number(p.get('auth_date'));
  if (!(age >= -60 && age < MAX_AGE)) return null;
  try { const u = JSON.parse(p.get('user')); u.start = p.get('start_param') || ''; return u; } catch { return null; }
}
