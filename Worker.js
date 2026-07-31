export default {
	async fetch(request, env, ctx) {
		globalThis.TOKEN = env.TOKEN;
		globalThis.ADMIN = env.ADMIN;

		const url = new URL(request.url);

		if (url.pathname === '/endpoint') {
			return await handleWebhook(request, env.db, ctx);
		} else if (url.pathname === '/registerWebhook' || url.pathname === '/set') {
			return await registerWebhook(request, url, '/endpoint', 'QUEVEDO_BZRP_Music_Sessions_522');
		} else if (url.pathname === '/unRegisterWebhook' || url.pathname === '/unset') {
			return await unRegisterWebhook(request);
		} else {
			return new Response('Bot is running. Visit /registerWebhook to setup.', { status: 200 });
		}
	}
};

let TOKEN, ADMIN, db, ctx;

let userCache = null;
let userCacheTime = 0;
let banCache = null;
let banCacheTime = 0;
const CACHE_TTL = 86400000; // 24 hours

let membershipCache = new Map();
const MEMBERSHIP_CACHE_TTL = 60000; // 1 minute

let configCache = new Map();

let userMessageTracker = new Map();
let adminState = new Map();
const SPAM_CONFIG = {
	enabled: true,
	severeSpamThreshold: 10,
	moderateSpamThreshold: 5,
	firstOffenseBan: 5,
	secondOffenseBan: 15,
	thirdOffenseBan: 60,
	permanentBanAfter: 4,
	exemptAdmin: true
};

const DEFAULT_START_PHOTO = "AgACAgQAAxkBAAFAvYlpaQqcxAYffTtJeNcoB10RMEtK-gACBQtrG7NPSVNgi0IH8dfDGQEAAwIAA3cAAzgE";
const DEFAULT_START_CAPTION = `✨ سلام {first_name} عزیز! ✨

به ربات TeleBotCraft خوش آمدید 🎉

💬 شما می‌توانید هر پیامی را به من بفرستید
و من آن را به سازنده‌ام ارسال می‌کنم.

🌟 از اینکه از ربات ما استفاده می‌کنید
سپاسگزاریم! 🙏`;

async function getStartConfig(db) {
	const now = Date.now();
	if (configCache.has("start_config") && (now - configCache.get("start_config_time")) < CACHE_TTL) {
		return configCache.get("start_config");
	}

	let config = await db.get("start_config");
	let result;
	if (config) {
		result = JSON.parse(config);
	} else {
		result = { photo: DEFAULT_START_PHOTO, caption: DEFAULT_START_CAPTION };
	}

	configCache.set("start_config", result);
	configCache.set("start_config_time", now);
	return result;
}

async function getSourceConfig(db) {
	const now = Date.now();
	if (configCache.has("source_config") && (now - configCache.get("source_config_time")) < CACHE_TTL) {
		return configCache.get("source_config");
	}

	let config = await db.get("source_config");
	let result;
	if (config) {
		result = JSON.parse(config);
	} else {
		result = {
			document: "BQACAgQAAxkBAAFAvl9paRddHeGhMoEbcpEfgC3B2qwKjwACBRwAAme9SFOaWQ05S8JQ4jgE",
			caption: "📦 سورس کد ربات تقدیم شما"
		};
	}

	configCache.set("source_config", result);
	configCache.set("source_config_time", now);
	return result;
}

async function getChannels(db) {
	const now = Date.now();
	if (configCache.has("channels") && (now - configCache.get("channels_time")) < CACHE_TTL) {
		return configCache.get("channels");
	}

	let channels = await db.get("channels");
	let result;
	if (channels) {
		result = JSON.parse(channels);
	} else {
		result = ["@badguysORG"];
	}

	configCache.set("channels", result);
	configCache.set("channels_time", now);
	return result;
}

async function getAnonConfig(db) {
	const now = Date.now();
	if (configCache.has("anon_config") && (now - configCache.get("anon_config_time")) < CACHE_TTL) {
		return configCache.get("anon_config");
	}

	let config = await db.get("anon_config");
	let result;
	if (config) {
		result = JSON.parse(config);
	} else {
		result = { enabled: false };
	}

	configCache.set("anon_config", result);
	configCache.set("anon_config_time", now);
	return result;
}

const FORCE_JOIN_ENABLED = true;

const BOT_SOURCE_URL = "https://github.com/yourusername/your-repo";

async function handleWebhook(request, database, context) {
	if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== 'QUEVEDO_BZRP_Music_Sessions_522') {
		return new Response('Unauthorized', { status: 403 });
	}

	const update = await request.json();

	if (!TOKEN) {
		TOKEN = globalThis.TOKEN;
		ADMIN = globalThis.ADMIN;
		db = database;
		ctx = context;
	}

	ctx.waitUntil(onUpdate(update, database));

	return new Response('Ok');
}

function escapeHtml(text) {
	if (!text) return "";
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function replaceTags(text, user) {
	if (!text) return "";

	const now = new Date();
	const dateStr = now.toISOString().split('T')[0];
	const timeStr = now.toISOString().split('T')[1].split('.')[0];
	const fullName = (user.first_name + " " + (user.last_name || "")).trim();
	const mention = `<a href="tg://user?id=${user.id}">${escapeHtml(fullName)}</a>`;

	return text
		.replace(/{first_name}/g, escapeHtml(user.first_name || ""))
		.replace(/{last_name}/g, escapeHtml(user.last_name || ""))
		.replace(/{full_name}/g, escapeHtml(fullName))
		.replace(/{username}/g, user.username ? "@" + user.username : "No Username")
		.replace(/{id}/g, user.id)
		.replace(/{date}/g, dateStr)
		.replace(/{time}/g, timeStr)
		.replace(/{mention}/g, mention);
}

async function onUpdate(update, db) {
	try {
		if ('callback_query' in update) {
			await onCallbackQuery(update.callback_query, db);
		} else if ('message' in update) {
			if (update.message.chat.type === "private") {
				if (update.message.text && update.message.text === "/start") {
					await onstart(update.message, db);
				} else {
					await onMessage(update.message, db);
				}
			}
		} else if ('edited_message' in update) {
			if (update.edited_message.chat.type === "private") {
				await onMessageedit(update.edited_message, db);
			}
		}
	} catch (e) {
		console.error("Crash detected:", e);
		try {
			const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
			if (chatId) {
				await fetch(apiUrl('sendMessage', {
					chat_id: chatId,
					text: `⚠️ **CRASH REPORT** ⚠️\n\nError: ${e.message}\n\n${e.stack ? e.stack.substring(0, 1000) : ''}`
				}));
			}
		} catch (innerErr) {
			console.error("Failed to send crash report:", innerErr);
		}
	}
	return new Response('Ok');
}

async function checkSpamStatus(userId, db) {
	if (!SPAM_CONFIG.enabled) return { allowed: true, reason: null };
	if (SPAM_CONFIG.exemptAdmin && userId == ADMIN) return { allowed: true, reason: null };

	const now = Date.now();
	let userTrack = userMessageTracker.get(userId);

	// Lazy load from KV
	if (!userTrack) {
		const savedState = await db.get(`spam_state_${userId}`);
		if (savedState) {
			const parsed = JSON.parse(savedState);
			userTrack = {
				messages: [],
				offenseCount: parsed.offenseCount || 0,
				tempBanUntil: parsed.tempBanUntil || 0,
				lastMessageTime: 0
			};
		} else {
			userTrack = {
				messages: [],
				offenseCount: 0,
				tempBanUntil: 0,
				lastMessageTime: 0
			};
		}
		userMessageTracker.set(userId, userTrack);
	}

	if (userTrack.tempBanUntil > now) {
		const remainingMinutes = Math.ceil((userTrack.tempBanUntil - now) / 60000);
		return {
			allowed: false,
			reason: 'temp_ban',
			remainingMinutes: remainingMinutes,
			offenseCount: userTrack.offenseCount,
			shouldWarn: false,
			shouldBan: false
		};
	}

	userTrack.messages = userTrack.messages.filter(timestamp => now - timestamp < 3600000);

	const messagesLastMinute = userTrack.messages.filter(t => now - t < 60000).length;

	if (messagesLastMinute >= SPAM_CONFIG.severeSpamThreshold) {
		userTrack.offenseCount += 1;

		let banMinutes;
		if (userTrack.offenseCount === 1) {
			banMinutes = SPAM_CONFIG.firstOffenseBan;
		} else if (userTrack.offenseCount === 2) {
			banMinutes = SPAM_CONFIG.secondOffenseBan;
		} else if (userTrack.offenseCount === 3) {
			banMinutes = SPAM_CONFIG.thirdOffenseBan;
		} else {
			// Persist permanent ban state
			await db.put(`spam_state_${userId}`, JSON.stringify({
				offenseCount: userTrack.offenseCount,
				tempBanUntil: 0
			}));
			return {
				allowed: false,
				reason: 'permanent_ban',
				messagesLastMinute: messagesLastMinute,
				offenseCount: userTrack.offenseCount,
				shouldWarn: false,
				shouldBan: true
			};
		}

		userTrack.tempBanUntil = now + (banMinutes * 60000);
		userMessageTracker.set(userId, userTrack);

		// Persist temp ban state
		await db.put(`spam_state_${userId}`, JSON.stringify({
			offenseCount: userTrack.offenseCount,
			tempBanUntil: userTrack.tempBanUntil
		}));

		return {
			allowed: false,
			reason: 'severe_spam',
			messagesLastMinute: messagesLastMinute,
			banMinutes: banMinutes,
			offenseCount: userTrack.offenseCount,
			shouldWarn: false,
			shouldBan: false
		};
	}

	if (messagesLastMinute >= SPAM_CONFIG.moderateSpamThreshold) {
		return {
			allowed: true,
			reason: 'moderate_warning',
			messagesLastMinute: messagesLastMinute,
			remaining: SPAM_CONFIG.severeSpamThreshold - messagesLastMinute,
			shouldWarn: true,
			shouldBan: false
		};
	}

	return {
		allowed: true,
		reason: null,
		shouldWarn: false,
		shouldBan: false
	};
}

function recordUserMessage(userId) {
	if (!SPAM_CONFIG.enabled) return;
	if (SPAM_CONFIG.exemptAdmin && userId == ADMIN) return;

	const now = Date.now();
	const userTrack = userMessageTracker.get(userId) || {
		messages: [],
		offenseCount: 0,
		tempBanUntil: 0,
		lastMessageTime: 0
	};

	userTrack.messages.push(now);
	userTrack.lastMessageTime = now;
	userMessageTracker.set(userId, userTrack);
}

async function sendSpamMessage(chatId, messageId, spamStatus) {
	let message = "";

	if (spamStatus.reason === 'temp_ban') {
		const emoji = spamStatus.offenseCount === 1 ? '⚠️' : spamStatus.offenseCount === 2 ? '🔴' : '🚫';
		message = `${emoji} شما موقتاً مسدود شدید (تخلف ${spamStatus.offenseCount})\n\n⏰ زمان باقی‌مانده: ${spamStatus.remainingMinutes} دقیقه\n\n💡 لطفا بعد از رفع مسدودیت با آرامش پیام بفرستید.`;
	} else if (spamStatus.reason === 'permanent_ban') {
		message = `🚫 شما به دلیل ارسال مکرر پیام‌های زیاد (${spamStatus.messagesLastMinute} پیام در 1 دقیقه) به طور دائم مسدود شدید.\n\n⚠️ برای رفع مسدودیت با ادمین تماس بگیرید.`;
	} else if (spamStatus.reason === 'severe_spam') {
		const emoji = spamStatus.offenseCount === 1 ? '⚠️' : spamStatus.offenseCount === 2 ? '🔴' : '🚫';
		message = `${emoji} اسپم شدید! (${spamStatus.messagesLastMinute} پیام در 1 دقیقه)\n\n⏰ مسدودیت موقت: ${spamStatus.banMinutes} دقیقه\n📊 تخلف ${spamStatus.offenseCount} از ${SPAM_CONFIG.permanentBanAfter}\n\n⚠️ ${SPAM_CONFIG.permanentBanAfter - spamStatus.offenseCount} تخلف دیگر = بن دائم`;
	} else if (spamStatus.reason === 'moderate_warning') {
		message = `⚠️ شما خیلی سریع پیام می‌فرستید!\n\n📊 ${spamStatus.messagesLastMinute} پیام در 1 دقیقه\n🔴 ${spamStatus.remaining} پیام تا مسدودیت موقت\n\n💡 لطفا کمی آرام‌تر پیام بفرستید.`;
	}

	await apiPost('sendMessage', {
		chat_id: chatId,
		text: message,
		reply_to_message_id: messageId
	});
}

async function checkAllChannelsMembership(userId, db) {
	if (!FORCE_JOIN_ENABLED) return { allJoined: true, notJoinedChannels: [] };
	if (userId == ADMIN) return { allJoined: true, notJoinedChannels: [] };

	const notJoinedChannels = [];
	const channels = await getChannels(db);

	// Parallel API calls instead of sequential
	const results = await Promise.all(
		channels.map(channel =>
			apiPost('getChatMember', {
				chat_id: channel,
				user_id: userId
			}).then(r => r.json()).catch(() => ({ ok: false }))
		)
	);

	channels.forEach((channel, idx) => {
		const response = results[idx];
		if (response.ok) {
			const status = response.result.status;
			const isMember = ['member', 'administrator', 'creator'].includes(status);
			if (!isMember) {
				notJoinedChannels.push(channel);
			}
		} else {
			console.error(`Failed to check membership for ${userId} in ${channel}:`, response);
		}
	});

	const result = {
		allJoined: notJoinedChannels.length === 0,
		notJoinedChannels: notJoinedChannels
	};

	return result;
}

async function sendForceJoinMessage(chatId, messageId, notJoinedChannels, db) {
	const startConfig = await getStartConfig(db);
	const channelButtons = notJoinedChannels.map(channel => {
		return [{
			text: `📢 عضویت در ${channel}`,
			url: `https://t.me/${channel.replace('@', '')}`
		}];
	});

	let channelList = notJoinedChannels.map((ch, idx) => `${idx + 1}. ${ch}`).join('\n');

	const replyMarkup = {
		inline_keyboard: [
			...channelButtons,
			[{ text: "✅ عضو شدم - بررسی عضویت", callback_data: "check_membership" }]
		]
	};

	const caption = `❌ برای استفاده از ربات باید در کانال‌های ما عضو شوید!
  
  📢 لطفا ابتدا در کانال‌های زیر عضو شوید:
  
  ${channelList}
  
  سپس روی دکمه "✅ عضو شدم" کلیک کنید.`;

	try {
		const resp = await apiPost('sendPhoto', {
			chat_id: chatId,
			photo: startConfig.photo,
			caption: caption,
			reply_markup: replyMarkup,
			reply_to_message_id: messageId
		});
		if (!resp.ok) throw new Error("Failed");
	} catch (e) {
		await apiPost('sendMessage', {
			chat_id: chatId,
			text: caption,
			reply_markup: replyMarkup,
			reply_to_message_id: messageId
		});
	}
}

async function getUsers(db) {
	const now = Date.now();
	if (userCache && (now - userCacheTime) < CACHE_TTL) {
		return userCache;
	}

	const users = ((await db.get("users"))?.trim().split("\n")) || [];
	userCache = users.filter(u => u.length > 0);
	userCacheTime = now;
	return userCache;
}

async function getBanList(db) {
	const now = Date.now();
	if (banCache && (now - banCacheTime) < CACHE_TTL) {
		return banCache;
	}

	const ban = ((await db.get("ban"))?.trim().split("\n")) || [];
	banCache = ban.filter(b => b.length > 0);
	banCacheTime = now;
	return banCache;
}

function clearUserCache() {
	userCache = null;
}

function clearBanCache() {
	banCache = null;
}

async function onMessageedit(message, db) {
	const membershipStatus = await checkAllChannelsMembership(message.from.id, db);
	if (!membershipStatus.allJoined) {
		return;
	}

	const ban = await getBanList(db);

	if (message.from.id == ADMIN || !(ban.includes(message.from.id.toString()))) {
		let timestamp = message.edit_date;
		let date = new Date(timestamp * 1000);
		let hours = String(date.getUTCHours()).padStart(2, '0');
		let minutes = String(date.getUTCMinutes()).padStart(2, '0');
		let seconds = String(date.getUTCSeconds()).padStart(2, '0');

		const replymarkup24 = JSON.stringify({
			inline_keyboard: [
				[{ text: `ویرایش شد:${hours}:${minutes}:${seconds}`, callback_data: message.chat.id + ':' + message.message_id }],
				[
					{ text: message.chat.first_name, callback_data: message.chat.id + ':' + message.message_id },
					{ text: "اسم طرف", callback_data: message.chat.id + ':' + message.message_id }
				],
				[
					{ text: ((message.chat.last_name) || "هیچی"), callback_data: message.chat.id + ':' + message.message_id },
					{ text: "فامیل طرف", callback_data: message.chat.id + ':' + message.message_id }
				],
				[
					{ text: message.chat.id, callback_data: message.chat.id + ':' + message.message_id },
					{ text: "ایدی عددی طرف", callback_data: message.chat.id + ':' + message.message_id }
				],
				[{ text: "بن کردن کاربر", callback_data: "ban" }],
				[{ text: "رفتن به پیوی", url: ((message.chat.username && 't.me/' + message.chat.username) || 'tg://openmessage?user_id=' + message.chat.id) }]
			]
		});

		const replymarkup25 = JSON.stringify({
			inline_keyboard: [[{ text: `ویرایش شد:${hours}:${minutes}:${seconds}`, callback_data: message.message_id }]]
		});

		let filedata = "";
		if (message.photo) {
			filedata = JSON.stringify({ type: 'photo', media: (Array.isArray(message.photo) ? message.photo[message.photo.length - 1].file_id : message.photo.file_id) });
		} else if (message.animation) {
			filedata = JSON.stringify({ type: 'animation', media: (Array.isArray(message.animation) ? message.animation[message.animation.length - 1].file_id : message.animation.file_id) });
		} else if (message.video) {
			filedata = JSON.stringify({ type: 'video', media: (Array.isArray(message.video) ? message.video[message.video.length - 1].file_id : message.video.file_id) });
		} else if (message.document) {
			filedata = JSON.stringify({ type: 'document', media: (Array.isArray(message.document) ? message.document[message.document.length - 1].file_id : message.document.file_id) });
		} else if (message.audio) {
			filedata = JSON.stringify({ type: 'audio', media: (Array.isArray(message.audio) ? message.audio[message.audio.length - 1].file_id : message.audio.file_id) });
		} else if (message.sticker) {
			filedata = JSON.stringify({ type: 'sticker', media: (Array.isArray(message.sticker) ? message.sticker[message.sticker.length - 1].file_id : message.sticker.file_id) });
		} else if (message.voice) {
			filedata = JSON.stringify({ type: 'voice', media: (Array.isArray(message.voice) ? message.voice[message.voice.length - 1].file_id : message.voice.file_id) });
		}

		if (message.from.id != ADMIN) {
			if (filedata) {
				try {
					await fetch(apiUrl('editMessageMedia', { chat_id: ADMIN, message_id: message.message_id + 1, media: filedata, reply_markup: replymarkup24 }));
				} catch (error) { }
				try {
					await fetch(apiUrl('editMessageCaption', { chat_id: ADMIN, message_id: message.message_id + 1, caption: message.caption || "", reply_markup: replymarkup24 }));
				} catch (error) { }
			} else {
				await fetch(apiUrl('editMessageText', { chat_id: ADMIN, message_id: message.message_id + 1, text: message.text || message.caption || "", reply_markup: replymarkup24 }));
			}
		} else {
			const id23 = message.reply_to_message.reply_markup.inline_keyboard[0][0].callback_data.split(":");
			if (filedata) {
				try {
					await fetch(apiUrl('editMessageMedia', { chat_id: id23[0], message_id: message.message_id + 1, media: filedata, reply_markup: replymarkup25 }));
				} catch (error) { }
				try {
					await fetch(apiUrl('editMessageCaption', { chat_id: id23[0], message_id: message.message_id + 1, caption: message.text || message.caption || "", reply_markup: replymarkup25 }));
				} catch (error) { }
			} else {
				await fetch(apiUrl('editMessageText', { chat_id: id23[0], message_id: message.message_id + 1, text: message.text || message.caption || "", reply_markup: replymarkup25 }));
			}
		}
	}
	return new Response('Ok');
}

async function sendAdminPanel(chatId, messageId, db) {
	const anonConfig = await getAnonConfig(db);
	const anonStatus = anonConfig.enabled ? "✅" : "❌";

	const replyMarkup = {
		inline_keyboard: [
			[
				{ text: "🚫 بن کاربر", callback_data: "admin_ban" },
				{ text: "✅ انبن کاربر", callback_data: "admin_unban" }
			],
			[
				{ text: "⏰ بن موقت", callback_data: "admin_tempban" }
			],
			[
				{ text: "📋 لیست بن‌شدگان", callback_data: "admin_banlist" },
				{ text: "🗑️ پاکسازی بن‌ها", callback_data: "admin_cleanban" }
			],
			[
				{ text: "📢 ارسال همگانی", callback_data: "admin_broadcast" }
			],
			[
				{ text: "👥 تعداد کاربران", callback_data: "admin_usercount" },
				{ text: "📊 آمار اسپم", callback_data: "admin_spamstats" }
			],
			[
				{ text: `🕵️ پیام ناشناس: ${anonStatus}`, callback_data: "admin_toggle_anon" }
			],
			[
				{ text: "📝 تنظیم پیام خوش‌آمد", callback_data: "admin_set_welcome" },
				{ text: "📦 تنظیم سورس", callback_data: "admin_set_source" }
			],
			[
				{ text: "📢 تنظیم کانال‌ها", callback_data: "admin_manage_channels" }
			],
			[
				{ text: "💻 سورس ربات", callback_data: "source_code" }
			]
		]
	};

	await apiPost('editMessageCaption', {
		chat_id: chatId,
		message_id: messageId,
		caption: `✨ سلام مدیر عزیز! خوش آمدید ✨
  
  🎛️ پنل مدیریت ربات
  کلیک کنید تا عملیات را انجام دهید:`,
		reply_markup: replyMarkup
	});
}

async function onstart(message, db) {
	const ban = await getBanList(db);

	if (message.from.id != ADMIN && ban.includes(message.from.id.toString())) {
		return;
	}

	const membershipStatus = await checkAllChannelsMembership(message.from.id, db);
	if (!membershipStatus.allJoined) {
		await sendForceJoinMessage(message.chat.id, message.message_id, membershipStatus.notJoinedChannels, db);
		return;
	}

	if (message.from.id != ADMIN) {
		await addUser(message.from.id, db);
	}

	if (message.from.id == ADMIN) {
		const startConfig = await getStartConfig(db);
		const anonConfig = await getAnonConfig(db);
		const anonStatus = anonConfig.enabled ? "✅" : "❌";

		try {
			const resp = await fetch(apiUrl('sendPhoto', {
				chat_id: message.chat.id,
				photo: startConfig.photo,
				caption: `✨ سلام مدیر عزیز! خوش آمدید ✨
	  
	  🎛️ پنل مدیریت ربات
	  کلیک کنید تا عملیات را انجام دهید:`,
				reply_markup: JSON.stringify({
					inline_keyboard: [
						[
							{ text: "🚫 بن کاربر", callback_data: "admin_ban" },
							{ text: "✅ انبن کاربر", callback_data: "admin_unban" }
						],
						[
							{ text: "⏰ بن موقت", callback_data: "admin_tempban" }
						],
						[
							{ text: "📋 لیست بن‌شدگان", callback_data: "admin_banlist" },
							{ text: "🗑️ پاکسازی بن‌ها", callback_data: "admin_cleanban" }
						],
						[
							{ text: "📢 ارسال همگانی", callback_data: "admin_broadcast" }
						],
						[
							{ text: "👥 تعداد کاربران", callback_data: "admin_usercount" },
							{ text: "📊 آمار اسپم", callback_data: "admin_spamstats" }
						],
						[
							{ text: `🕵️ پیام ناشناس: ${anonStatus}`, callback_data: "admin_toggle_anon" }
						],
						[
							{ text: "📝 تنظیم پیام خوش‌آمد", callback_data: "admin_set_welcome" },
							{ text: "📦 تنظیم سورس", callback_data: "admin_set_source" }
						],
						[
							{ text: "📢 تنظیم کانال‌ها", callback_data: "admin_manage_channels" }
						],
						[
							{ text: "💻 سورس ربات", callback_data: "source_code" }
						]
					]
				}),
				reply_to_message_id: message.message_id
			}));
			if (!resp.ok) throw new Error("Failed");
		} catch (e) {
			await fetch(apiUrl('sendMessage', {
				chat_id: message.chat.id,
				text: `✨ سلام مدیر عزیز! خوش آمدید ✨
	  
	  🎛️ پنل مدیریت ربات
	  کلیک کنید تا عملیات را انجام دهید:`,
				reply_markup: JSON.stringify({
					inline_keyboard: [
						[
							{ text: "🚫 بن کاربر", callback_data: "admin_ban" },
							{ text: "✅ انبن کاربر", callback_data: "admin_unban" }
						],
						[
							{ text: "⏰ بن موقت", callback_data: "admin_tempban" }
						],
						[
							{ text: "📋 لیست بن‌شدگان", callback_data: "admin_banlist" },
							{ text: "🗑️ پاکسازی بن‌ها", callback_data: "admin_cleanban" }
						],
						[
							{ text: "📢 ارسال همگانی", callback_data: "admin_broadcast" }
						],
						[
							{ text: "👥 تعداد کاربران", callback_data: "admin_usercount" },
							{ text: "📊 آمار اسپم", callback_data: "admin_spamstats" }
						],
						[
							{ text: `🕵️ پیام ناشناس: ${anonStatus}`, callback_data: "admin_toggle_anon" }
						],
						[
							{ text: "📝 تنظیم پیام خوش‌آمد", callback_data: "admin_set_welcome" },
							{ text: "📦 تنظیم سورس", callback_data: "admin_set_source" }
						],
						[
							{ text: "📢 تنظیم کانال‌ها", callback_data: "admin_manage_channels" }
						],
						[
							{ text: "💻 سورس ربات", callback_data: "source_code" }
						]
					]
				}),
				reply_to_message_id: message.message_id
			}));
		}
	} else {
		const startConfig = await getStartConfig(db);
		const channels = await getChannels(db);
		const mainChannel = channels.length > 0 ? channels[0] : "@badguysORG";

		try {
			const keyboard = [
				[
					{ text: "💻 سورس ربات", callback_data: "source_code" }
				],
				[
					{ text: "📱 کانال ما", url: `https://t.me/${mainChannel.replace('@', '')}` }
				]
			];

			const anonConfig = await getAnonConfig(db);
			if (anonConfig.enabled) {
				keyboard.unshift([{ text: "🕵️ ارسال پیام ناشناس", callback_data: "start_anon" }]);
			}

			const resp = await fetch(apiUrl('sendPhoto', {
				chat_id: message.chat.id,
				photo: startConfig.photo,
				caption: replaceTags(startConfig.caption, message.from),
				parse_mode: "HTML",
				reply_markup: JSON.stringify({
					inline_keyboard: keyboard
				}),
				reply_to_message_id: message.message_id
			}));
			if (!resp.ok) throw new Error("Failed");
		} catch (e) {
			const keyboard = [
				[
					{ text: "💻 سورس ربات", callback_data: "source_code" }
				],
				[
					{ text: "📱 کانال ما", url: `https://t.me/${mainChannel.replace('@', '')}` }
				]
			];

			const anonConfig = await getAnonConfig(db);
			if (anonConfig.enabled) {
				keyboard.unshift([{ text: "🕵️ ارسال پیام ناشناس", callback_data: "start_anon" }]);
			}

			await fetch(apiUrl('sendMessage', {
				chat_id: message.chat.id,
				text: replaceTags(startConfig.caption, message.from),
				parse_mode: "HTML",
				reply_markup: JSON.stringify({
					inline_keyboard: keyboard
				}),
				reply_to_message_id: message.message_id
			}));
		}
	}
}

async function addUser(userId, db) {
	const users = await getUsers(db);
	const userIdStr = userId.toString();

	if (users.includes(userIdStr)) {
		return;
	}

	users.push(userIdStr);
	await db.put("users", users.join("\n"));
	// Cache is already updated by reference
}

async function onCallbackQuery(callback, db) {
	if (callback.data == "check_membership") {
		const membershipStatus = await checkAllChannelsMembership(callback.from.id, db);

		if (membershipStatus.allJoined) {
			await fetch(apiUrl('deleteMessage', {
				chat_id: callback.message.chat.id,
				message_id: callback.message.message_id
			}));

			await addUser(callback.from.id, db);

			const startConfig = await getStartConfig(db);
			const channels = await getChannels(db);
			const mainChannel = channels.length > 0 ? channels[0] : "@badguysORG";

			try {
				const keyboard = [
					[
						{ text: "💻 سورس ربات", callback_data: "source_code" }
					],
					[
						{ text: "📱 کانال ما", url: `https://t.me/${mainChannel.replace('@', '')}` }
					]
				];

				const anonConfig = await getAnonConfig(db);
				if (anonConfig.enabled) {
					keyboard.unshift([{ text: "🕵️ ارسال پیام ناشناس", callback_data: "start_anon" }]);
				}

				const resp = await fetch(apiUrl('sendPhoto', {
					chat_id: callback.from.id,
					photo: startConfig.photo,
					caption: replaceTags(startConfig.caption, callback.from),
					parse_mode: "HTML",
					reply_markup: JSON.stringify({
						inline_keyboard: keyboard
					})
				}));
				if (!resp.ok) throw new Error("Failed");
			} catch (e) {
				const keyboard = [
					[
						{ text: "💻 سورس ربات", callback_data: "source_code" }
					],
					[
						{ text: "📱 کانال ما", url: `https://t.me/${mainChannel.replace('@', '')}` }
					]
				];

				const anonConfig = await getAnonConfig(db);
				if (anonConfig.enabled) {
					keyboard.unshift([{ text: "🕵️ ارسال پیام ناشناس", callback_data: "start_anon" }]);
				}

				await fetch(apiUrl('sendMessage', {
					chat_id: callback.from.id,
					text: replaceTags(startConfig.caption, callback.from),
					parse_mode: "HTML",
					reply_markup: JSON.stringify({
						inline_keyboard: keyboard
					})
				}));
			}
		} else {
			let missingChannels = membershipStatus.notJoinedChannels.join('\n');
			await fetch(apiUrl('answerCallbackQuery', {
				callback_query_id: callback.id,
				text: `❌ هنوز در برخی کانال‌ها عضو نشدید:\n\n${missingChannels}\n\nلطفا ابتدا عضو شوید.`,
				show_alert: true
			}));
		}
		return;
	}

	if (callback.data == "source_code") {
		const sourceConfig = await getSourceConfig(db);
		await fetch(apiUrl('sendDocument', {
			chat_id: callback.message.chat.id,
			document: sourceConfig.document,
			caption: replaceTags(sourceConfig.caption, callback.from),
			parse_mode: "HTML",
			reply_to_message_id: callback.message.message_id
		}));
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
		return;
	}

	if (callback.data == "start_anon") {
		const anonConfig = await getAnonConfig(db);
		if (!anonConfig.enabled) {
			await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id, text: "❌ این قابلیت فعلا غیرفعال است.", show_alert: true }));
			return;
		}

		userMessageTracker.set(callback.from.id + "_anon_state", "waiting_for_anon_message"); // Using tracker for state

		await fetch(apiUrl('sendMessage', {
			chat_id: callback.message.chat.id,
			text: "🕵️ حالت پیام ناشناس فعال شد.\n\nلطفا پیام خود را (متن، عکس، ویس و...) ارسال کنید.\nفقط یک پیام می‌توانید بفرستید.",
			reply_markup: JSON.stringify({
				inline_keyboard: [[{ text: "❌ انصراف", callback_data: "cancel_anon" }]]
			})
		}));
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
		return;
	}
	else if (callback.data == "cancel_anon") {
		userMessageTracker.delete(callback.from.id + "_anon_state");
		await fetch(apiUrl('deleteMessage', { chat_id: callback.message.chat.id, message_id: callback.message.message_id }));
		await fetch(apiUrl('sendMessage', { chat_id: callback.message.chat.id, text: "❌ ارسال پیام ناشناس لغو شد." }));
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
		return;
	}

	if (callback.from.id != ADMIN) {
		await fetch(apiUrl('answerCallbackQuery', {
			callback_query_id: callback.id,
			text: "⛔ فقط ادمین می‌تواند از این دکمه استفاده کند!",
			show_alert: true
		}));
		return;
	}

	if (callback.data == "admin_ban") {
		adminState.set(callback.from.id, { step: 'waiting_for_ban_id' });
		await fetch(apiUrl('sendMessage', {
			chat_id: callback.message.chat.id,
			text: "🚫 لطفا آیدی عددی کاربر را برای بن کردن بفرستید:",
			reply_markup: JSON.stringify({
				inline_keyboard: [[{ text: "❌ انصراف", callback_data: "admin_cancel" }]]
			})
		}));
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
	}
	else if (callback.data == "admin_unban") {
		adminState.set(callback.from.id, { step: 'waiting_for_unban_id' });
		await fetch(apiUrl('sendMessage', {
			chat_id: callback.message.chat.id,
			text: "✅ لطفا آیدی عددی کاربر را برای انبن کردن بفرستید:",
			reply_markup: JSON.stringify({
				inline_keyboard: [[{ text: "❌ انصراف", callback_data: "admin_cancel" }]]
			})
		}));
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
	}
	else if (callback.data == "admin_tempban") {
		adminState.set(callback.from.id, { step: 'waiting_for_tempban_id' });
		await fetch(apiUrl('sendMessage', {
			chat_id: callback.message.chat.id,
			text: "⏰ لطفا آیدی عددی کاربر را برای بن موقت بفرستید:",
			reply_markup: JSON.stringify({
				inline_keyboard: [[{ text: "❌ انصراف", callback_data: "admin_cancel" }]]
			})
		}));
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
	}
	else if (callback.data == "admin_set_welcome") {
		adminState.set(callback.from.id, { step: 'waiting_for_welcome_photo' });
		await fetch(apiUrl('sendMessage', {
			chat_id: callback.message.chat.id,
			text: "🖼️ لطفا عکس جدید خوش‌آمدگویی را ارسال کنید:\n\n(می‌توانید از دکمه انصراف استفاده کنید)",
			reply_markup: JSON.stringify({
				inline_keyboard: [[{ text: "❌ انصراف", callback_data: "admin_cancel" }]]
			})
		}));
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
	}
	else if (callback.data == "admin_set_source") {
		adminState.set(callback.from.id, { step: 'waiting_for_source_file' });
		await fetch(apiUrl('sendMessage', {
			chat_id: callback.message.chat.id,
			text: "📦 لطفا فایل جدید سورس کد را ارسال کنید:\n\n(می‌توانید کپشن هم داشته باشد)",
			reply_markup: JSON.stringify({
				inline_keyboard: [[{ text: "❌ انصراف", callback_data: "admin_cancel" }]]
			})
		}));
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
	}
	else if (callback.data == "admin_banlist") {
		const ban = await getBanList(db);
		if (ban.length > 0) {
			await fetch(apiUrl('sendMessage', {
				chat_id: callback.message.chat.id,
				text: "📋 لیست بن شدگان:\n〰️\n<code>" + ban.join("</code>\n〰️\n<code>") + '</code>',
				parse_mode: "HTML"
			}));
		} else {
			await fetch(apiUrl('sendMessage', {
				chat_id: callback.message.chat.id,
				text: "✅ لیست بن‌شدگان خالی است!"
			}));
		}
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
	}
	else if (callback.data == "admin_cleanban") {
		const ban = await getBanList(db);
		if (ban.length > 0) {
			await db.delete("ban");
			banCache = []; // Update cache directly
			await fetch(apiUrl('sendMessage', {
				chat_id: callback.message.chat.id,
				text: "✅ لیست بن‌شدگان پاکسازی شد!"
			}));
		} else {
			await fetch(apiUrl('sendMessage', {
				chat_id: callback.message.chat.id,
				text: "ℹ️ لیست بن‌شدگان از قبل خالی است!"
			}));
		}
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
	}
	else if (callback.data == "admin_broadcast") {
		adminState.set(callback.from.id, { step: 'waiting_for_broadcast_message' });
		await fetch(apiUrl('sendMessage', {
			chat_id: callback.message.chat.id,
			text: "📢 لطفا پیامی که می‌خواهید همگانی ارسال کنید را بفرستید (متن، عکس، ...):",
			reply_markup: JSON.stringify({
				inline_keyboard: [[{ text: "❌ انصراف", callback_data: "admin_cancel" }]]
			})
		}));
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
	}
	else if (callback.data == "admin_cancel") {
		adminState.delete(callback.from.id);

		// Delete the prompt message
		await fetch(apiUrl('deleteMessage', {
			chat_id: callback.message.chat.id,
			message_id: callback.message.message_id
		}));

		// Send a fresh Admin Panel
		const startConfig = await getStartConfig(db);

		await fetch(apiUrl('sendPhoto', {
			chat_id: callback.message.chat.id,
			photo: startConfig.photo,
			caption: `✨ سلام مدیر عزیز! خوش آمدید ✨

🎛️ پنل مدیریت ربات
کلیک کنید تا عملیات را انجام دهید:`,
			reply_markup: JSON.stringify({
				inline_keyboard: [
					[
						{ text: "🚫 بن کاربر", callback_data: "admin_ban" },
						{ text: "✅ انبن کاربر", callback_data: "admin_unban" }
					],
					[
						{ text: "⏰ بن موقت", callback_data: "admin_tempban" }
					],
					[
						{ text: "📋 لیست بن‌شدگان", callback_data: "admin_banlist" },
						{ text: "🗑️ پاکسازی بن‌ها", callback_data: "admin_cleanban" }
					],
					[
						{ text: "📢 ارسال همگانی", callback_data: "admin_broadcast" }
					],
					[
						{ text: "👥 تعداد کاربران", callback_data: "admin_usercount" },
						{ text: "📊 آمار اسپم", callback_data: "admin_spamstats" }
					],
					[
						{ text: "📝 تنظیم پیام خوش‌آمد", callback_data: "admin_set_welcome" },
						{ text: "📦 تنظیم سورس", callback_data: "admin_set_source" }
					],
					[
						{ text: "📢 تنظیم کانال‌ها", callback_data: "admin_manage_channels" }
					],
					[
						{ text: "💻 سورس ربات", callback_data: "source_code" }
					]
				]
			})
		}));

		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
	}
	else if (callback.data == "admin_panel_back") {
		adminState.delete(callback.from.id);
		await sendAdminPanel(callback.message.chat.id, callback.message.message_id, db);
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
	}
	else if (callback.data == "admin_manage_channels") {
		const channels = await getChannels(db);
		let keyboard = [];

		channels.forEach(channel => {
			keyboard.push([{ text: channel, url: `https://t.me/${channel.replace('@', '')}` }, { text: "🗑️ حذف", callback_data: `admin_del_channel:${channel}` }]);
		});

		keyboard.push([{ text: "➕ افزودن کانال", callback_data: "admin_add_channel" }]);
		keyboard.push([{ text: "🔙 بازگشت", callback_data: "admin_panel_back" }]);

		await fetch(apiUrl('editMessageCaption', {
			chat_id: callback.message.chat.id,
			message_id: callback.message.message_id,
			caption: `📢 مدیریت کانال‌های جوین اجباری
لیست کانال‌های فعلی:`,
			reply_markup: JSON.stringify({
				inline_keyboard: keyboard
			})
		}));
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
	}
	else if (callback.data == "admin_add_channel") {
		adminState.set(callback.from.id, { step: 'waiting_for_channel_link' });
		await fetch(apiUrl('sendMessage', {
			chat_id: callback.message.chat.id,
			text: "📢 لطفا آیدی کانال (با @) یا لینک کانال را ارسال کنید:\n\n(مثال: @badguysORG)",
			reply_markup: JSON.stringify({
				inline_keyboard: [[{ text: "❌ انصراف", callback_data: "admin_cancel" }]]
			})
		}));
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
	}
	else if (callback.data.startsWith("admin_del_channel:")) {
		const channelToDelete = callback.data.split(":")[1];
		let channels = await getChannels(db);
		channels = channels.filter(c => c !== channelToDelete);

		await db.put("channels", JSON.stringify(channels));
		configCache.set("channels", channels); // Update cache directly

		// Refresh the list
		const newChannels = channels;
		let keyboard = [];

		newChannels.forEach(channel => {
			keyboard.push([{ text: channel, url: `https://t.me/${channel.replace('@', '')}` }, { text: "🗑️ حذف", callback_data: `admin_del_channel:${channel}` }]);
		});

		keyboard.push([{ text: "➕ افزودن کانال", callback_data: "admin_add_channel" }]);
		keyboard.push([{ text: "🔙 بازگشت", callback_data: "admin_panel_back" }]);

		await fetch(apiUrl('editMessageCaption', {
			chat_id: callback.message.chat.id,
			message_id: callback.message.message_id,
			caption: `✅ کانال ${channelToDelete} حذف شد.
📢 مدیریت کانال‌های جوین اجباری
لیست کانال‌های فعلی:`,
			reply_markup: JSON.stringify({
				inline_keyboard: keyboard
			})
		}));

		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id, text: "کانال حذف شد" }));
	}
	else if (callback.data == "admin_confirm_broadcast") {
		const state = adminState.get(callback.from.id);
		if (!state || state.step != 'waiting_for_broadcast_confirm') {
			await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id, text: "❌ نشست منقضی شده است.", show_alert: true }));
			return;
		}

		const users = await getUsers(db);
		if (users.length === 0) {
			await fetch(apiUrl('sendMessage', { chat_id: callback.message.chat.id, text: "❌ کاربری وجود ندارد." }));
			adminState.delete(callback.from.id);
			return;
		}

		await apiPost('editMessageText', {
			chat_id: callback.message.chat.id,
			message_id: callback.message.message_id,
			text: `✅ در حال ارسال به ${users.length} کاربر...`
		});

		const BATCH_SIZE = 30; // Parallel batch size
		let successCount = 0;
		let failCount = 0;

		for (let i = 0; i < users.length; i += BATCH_SIZE) {
			const batch = users.slice(i, i + BATCH_SIZE);
			const promises = batch.map(userId =>
				apiPost('copyMessage', {
					from_chat_id: state.chatId,
					message_id: state.messageId,
					chat_id: parseInt(userId)
				}).then(r => r.json()).catch(() => ({ ok: false }))
			);
			const results = await Promise.allSettled(promises);
			results.forEach(r => {
				if (r.status === 'fulfilled' && r.value.ok) successCount++;
				else failCount++;
			});
		}

		await fetch(apiUrl('sendMessage', {
			chat_id: callback.message.chat.id,
			text: `✅ پایان ارسال همگانی!\n\n📊 موفق: ${successCount}\n❌ ناموفق: ${failCount}\n📈 کل: ${users.length}`
		}));
		adminState.delete(callback.from.id);
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
	}
	else if (callback.data == "admin_usercount") {
		const users = await getUsers(db);
		await fetch(apiUrl('sendMessage', {
			chat_id: callback.message.chat.id,
			text: `👥 تعداد کاربران ربات: ${users.length} نفر`
		}));
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
	}
	else if (callback.data == "admin_spamstats") {
		let statsText = "📊 آمار سیستم ضد اسپم:\n\n";
		statsText += `⚙️ وضعیت: ${SPAM_CONFIG.enabled ? '✅ فعال' : '❌ غیرفعال'}\n`;
		statsText += `🔴 محدودیت اسپم: ${SPAM_CONFIG.severeSpamThreshold} پیام/دقیقه\n`;
		statsText += `⏰ بن اول: ${SPAM_CONFIG.firstOffenseBan} دقیقه\n`;
		statsText += `⏰ بن دوم: ${SPAM_CONFIG.secondOffenseBan} دقیقه\n`;
		statsText += `⏰ بن سوم: ${SPAM_CONFIG.thirdOffenseBan} دقیقه\n`;
		statsText += `🚫 بن دائم: پس از ${SPAM_CONFIG.permanentBanAfter} تخلف\n\n`;

		const trackedUsers = userMessageTracker.size;
		statsText += `👥 کاربران تحت نظر: ${trackedUsers}\n`;

		await fetch(apiUrl('sendMessage', {
			chat_id: callback.message.chat.id,
			text: statsText
		}));
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id }));
	}
	else if (callback.data == "ban") {
		const ban = await getBanList(db);
		const user_id = callback.message.reply_markup.inline_keyboard[0][0].callback_data.split(":")[0].toString();

		if (!(ban.includes(user_id))) {
			ban.push(user_id);
			await db.put("ban", ban.join("\n"));
			// Cache is already updated by reference
			await fetch(apiUrl('sendMessage', { chat_id: parseInt(user_id), text: "شما بن شدید" }));
		}
		await fetch(apiUrl('sendMessage', { chat_id: callback.message.chat.id, text: "✅ بن شد", reply_to_message_id: callback.message.message_id }));
		await fetch(apiUrl('deleteMessage', { chat_id: callback.message.chat.id, message_id: callback.message.message_id }));
	}
	else if (callback.data == "admin_toggle_anon") {
		const config = await getAnonConfig(db);
		config.enabled = !config.enabled;
		await db.put("anon_config", JSON.stringify(config));
		configCache.set("anon_config", config); // Update cache

		await sendAdminPanel(callback.message.chat.id, callback.message.message_id, db);
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id, text: `پیام ناشناس ${config.enabled ? "فعال" : "غیرفعال"} شد.` }));
	}
	else {
		await fetch(apiUrl('answerCallbackQuery', { callback_query_id: callback.id, text: "TeleBotCraft" }));
	}
	return new Response('Ok');
}

async function onMessage(message, db) {
	const text = message.text || "";

	const anonStateKey = message.from.id + "_anon_state";
	if (userMessageTracker.has(anonStateKey)) {
		if (userMessageTracker.get(anonStateKey) === "waiting_for_anon_message") {
			// Forward content to admin
			await fetch(apiUrl('sendMessage', {
				chat_id: ADMIN,
				text: "🕵️ **پیام ناشناس جدید** 👇"
			}));

			await fetch(apiUrl('copyMessage', {
				from_chat_id: message.chat.id,
				message_id: message.message_id,
				chat_id: ADMIN
			}));

			userMessageTracker.delete(anonStateKey);

			await fetch(apiUrl('sendMessage', {
				chat_id: message.chat.id,
				text: "✅ پیام ناشناس شما برای مدیر ارسال شد.",
				reply_to_message_id: message.message_id
			}));
			return;
		}
	}

	if (message.from.id == ADMIN) {
		const state = adminState.get(message.from.id);
		if (state) {
			if (state.step == 'waiting_for_ban_id') {
				const userId = text.trim();
				if (!/^\d+$/.test(userId)) {
					await fetch(apiUrl('sendMessage', { chat_id: message.chat.id, text: "❌ لطفا فقط عدد ارسال کنید." }));
					return;
				}
				const ban = await getBanList(db);
				if (!ban.includes(userId)) {
					ban.push(userId);
					await db.put("ban", ban.join("\n"));
					clearBanCache();
					await fetch(apiUrl('sendMessage', { chat_id: parseInt(userId), text: "شما بن شدید" }));
				}
				await fetch(apiUrl('sendMessage', { chat_id: message.chat.id, text: `✅ کاربر ${userId} بن شد.` }));
				adminState.delete(message.from.id);
				return;
			}
			else if (state.step == 'waiting_for_unban_id') {
				const userId = text.trim();
				if (!/^\d+$/.test(userId)) {
					await fetch(apiUrl('sendMessage', { chat_id: message.chat.id, text: "❌ لطفا فقط عدد ارسال کنید." }));
					return;
				}
				const ban = await getBanList(db);
				if (ban.includes(userId)) {
					const ban2 = ban.filter(id => id !== userId);
					if (ban2.length > 0) await db.put("ban", ban2.join("\n"));
					else await db.delete("ban");
					clearBanCache();
					const userTrack = userMessageTracker.get(userId);
					if (userTrack) {
						userTrack.tempBanUntil = 0;
						userTrack.offenseCount = 0;
						userMessageTracker.set(userId, userTrack);
					}
					await fetch(apiUrl('sendMessage', { chat_id: parseInt(userId), text: "✅ انبن شدید" }));
				}
				await fetch(apiUrl('sendMessage', { chat_id: message.chat.id, text: `✅ کاربر ${userId} انبن شد.` }));
				adminState.delete(message.from.id);
				return;
			}
			else if (state.step == 'waiting_for_tempban_id') {
				const userId = text.trim();
				if (!/^\d+$/.test(userId)) {
					await fetch(apiUrl('sendMessage', { chat_id: message.chat.id, text: "❌ لطفا فقط عدد ارسال کنید." }));
					return;
				}
				adminState.set(message.from.id, { step: 'waiting_for_tempban_duration', userId: userId });
				await fetch(apiUrl('sendMessage', { chat_id: message.chat.id, text: "⏰ مدت زمان بن را به دقیقه وارد کنید:" }));
				return;
			}
			else if (state.step == 'waiting_for_tempban_duration') {
				const minutes = parseInt(text.trim());
				if (isNaN(minutes) || minutes <= 0) {
					await fetch(apiUrl('sendMessage', { chat_id: message.chat.id, text: "❌ لطفا یک عدد معتبر وارد کنید." }));
					return;
				}
				const userId = state.userId;
				const userTrack = userMessageTracker.get(userId) || { messages: [], offenseCount: 0, tempBanUntil: 0, lastMessageTime: 0 };
				userTrack.tempBanUntil = Date.now() + (minutes * 60000);
				userMessageTracker.set(userId, userTrack);

				await fetch(apiUrl('sendMessage', { chat_id: parseInt(userId), text: `⚠️ شما برای ${minutes} دقیقه مسدود شدید.` }));
				await fetch(apiUrl('sendMessage', { chat_id: message.chat.id, text: `✅ کاربر ${userId} برای ${minutes} دقیقه مسدود شد.` }));
				adminState.delete(message.from.id);
				return;
			}
			else if (state.step == 'waiting_for_welcome_photo') {
				if (message.photo) {
					const photo = message.photo[message.photo.length - 1].file_id;
					const caption = message.caption || message.text || DEFAULT_START_CAPTION;

					const config = { photo: photo, caption: caption };
					await db.put("start_config", JSON.stringify(config));
					configCache.set("start_config", config); // Update cache directly

					await fetch(apiUrl('sendMessage', {
						chat_id: message.chat.id,
						text: "✅ پیام خوش‌آمدگویی با موفقیت آپدیت شد!",
						reply_to_message_id: message.message_id
					}));
				} else {
					await fetch(apiUrl('sendMessage', {
						chat_id: message.chat.id,
						text: "❌ لطفا یک عکس ارسال کنید (می‌توانید کپشن هم داشته باشد).",
						reply_to_message_id: message.message_id
					}));
					return;
				}
				adminState.delete(message.from.id);
				return;
			}
			else if (state.step == 'waiting_for_source_file') {
				if (message.document) {
					const document = message.document.file_id;
					const caption = message.caption || message.text || "📦 سورس کد ربات تقدیم شما";

					const config = { document: document, caption: caption };
					await db.put("source_config", JSON.stringify(config));
					configCache.set("source_config", config); // Update cache directly

					await fetch(apiUrl('sendMessage', {
						chat_id: message.chat.id,
						text: "✅ فایل سورس کد با موفقیت آپدیت شد!",
						reply_to_message_id: message.message_id
					}));
				} else {
					await fetch(apiUrl('sendMessage', {
						chat_id: message.chat.id,
						text: "❌ لطفا یک فایل (Document) ارسال کنید.",
						reply_to_message_id: message.message_id
					}));
					return;
				}
				adminState.delete(message.from.id);
				return;
			}
			else if (state.step == 'waiting_for_channel_link') {
				let channel = message.text ? message.text.trim() : "";

				if (channel) {
					// Basic validation: add @ if missing and not a link
					if (!channel.startsWith("@") && !channel.startsWith("http")) {
						channel = "@" + channel;
					}
					// Extract username from link if needed (simple logic)
					if (channel.startsWith("https://t.me/")) {
						channel = "@" + channel.replace("https://t.me/", "").split("/")[0];
					}

					let channels = await getChannels(db);
					if (!channels.includes(channel)) {
						channels.push(channel);
						await db.put("channels", JSON.stringify(channels));
						// Cache is already updated by reference

						await fetch(apiUrl('sendMessage', {
							chat_id: message.chat.id,
							text: `✅ کانال ${channel} با موفقیت اضافه شد!`,
							reply_to_message_id: message.message_id
						}));
					} else {
						await fetch(apiUrl('sendMessage', {
							chat_id: message.chat.id,
							text: `⚠️ کانال ${channel} قبلاً در لیست وجود داشت.`,
							reply_to_message_id: message.message_id
						}));
					}
				} else {
					await fetch(apiUrl('sendMessage', {
						chat_id: message.chat.id,
						text: "❌ لطفا یک آیدی یا لینک معتبر ارسال کنید.",
						reply_to_message_id: message.message_id
					}));
					return;
				}
				adminState.delete(message.from.id);
				return;
			}
			else if (state.step == 'waiting_for_broadcast_message') {
				adminState.set(message.from.id, { step: 'waiting_for_broadcast_confirm', messageId: message.message_id, chatId: message.chat.id });
				await fetch(apiUrl('copyMessage', { from_chat_id: message.chat.id, message_id: message.message_id, chat_id: message.chat.id }));
				await fetch(apiUrl('sendMessage', {
					chat_id: message.chat.id,
					text: "📢 آیا از ارسال این پیام به همه کاربران اطمینان دارید؟",
					reply_markup: JSON.stringify({
						inline_keyboard: [
							[{ text: "✅ بله، ارسال کن", callback_data: "admin_confirm_broadcast" }],
							[{ text: "❌ خیر، لغو کن", callback_data: "admin_cancel" }]
						]
					})
				}));
				return;
			}
		}

		if (text.split(" ").length == 2 && text.split(" ")[0] == "ban" && !isNaN(text.split(" ")[1] / 0)) {
			const user_id = text.split(" ")[1];
			const ban = await getBanList(db);

			if (!(ban.includes(user_id))) {
				ban.push(user_id);
				await db.put("ban", ban.join("\n"));
				// Cache is already updated by reference
				await fetch(apiUrl('sendMessage', { chat_id: parseInt(user_id), text: "شما بن شدید" }));
			}
			await fetch(apiUrl('sendMessage', { chat_id: message.chat.id, text: "✅ بن شد", reply_to_message_id: message.message_id }));
			return;
		}
		else if (text.split(" ").length == 3 && text.split(" ")[0] == "tempban" && !isNaN(text.split(" ")[1] / 0) && !isNaN(text.split(" ")[2] / 0)) {
			const user_id = text.split(" ")[1];
			const minutes = parseInt(text.split(" ")[2]);

			const userTrack = userMessageTracker.get(user_id) || {
				messages: [],
				offenseCount: 0,
				tempBanUntil: 0,
				lastMessageTime: 0
			};

			userTrack.tempBanUntil = Date.now() + (minutes * 60000);
			userMessageTracker.set(user_id, userTrack);

			await fetch(apiUrl('sendMessage', {
				chat_id: parseInt(user_id),
				text: `⚠️ شما برای ${minutes} دقیقه مسدود شدید.`
			}));
			await fetch(apiUrl('sendMessage', {
				chat_id: message.chat.id,
				text: `✅ کاربر ${user_id} برای ${minutes} دقیقه مسدود شد`,
				reply_to_message_id: message.message_id
			}));
			return;
		}
		else if (text.split(" ").length == 2 && text.split(" ")[0] == "unban" && !isNaN(text.split(" ")[1] / 0)) {
			const user_id = text.split(" ")[1];
			const ban = await getBanList(db);

			if ((ban.includes(user_id))) {
				const ban2 = ban.filter(elem => elem !== user_id);
				if (ban2.length > 0) {
					await db.put("ban", ban2.join("\n"));
				} else {
					await db.delete("ban");
				}
				banCache = ban2; // Update cache directly
			}

			const userTrack = userMessageTracker.get(user_id);
			if (userTrack) {
				userTrack.tempBanUntil = 0;
				userTrack.offenseCount = 0;
				userMessageTracker.set(user_id, userTrack);
			}

			await fetch(apiUrl('sendMessage', { chat_id: parseInt(user_id), text: "✅ انبن شدید" }));
			await fetch(apiUrl('sendMessage', { chat_id: message.chat.id, text: "✅ انبن شد", reply_to_message_id: message.message_id }));
			return;
		}
		else if (text == "broadcast") {
			if (!message.reply_to_message) {
				await fetch(apiUrl('sendMessage', {
					chat_id: message.chat.id,
					text: "❌ لطفا پیامی که می‌خواهید ارسال کنید را ریپلای کنید",
					reply_to_message_id: message.message_id
				}));
				return;
			}

			const users = await getUsers(db);

			if (users.length === 0) {
				await fetch(apiUrl('sendMessage', {
					chat_id: message.chat.id,
					text: "❌ هیچ کاربری در دیتابیس وجود ندارد",
					reply_to_message_id: message.message_id
				}));
				return;
			}

			await fetch(apiUrl('sendMessage', {
				chat_id: message.chat.id,
				text: `✅ شروع ارسال به ${users.length} کاربر...\n\n⏳ این ممکن است چند دقیقه طول بکشد.\nدر پایان گزارش ارسال می‌شود.`,
				reply_to_message_id: message.message_id
			}));

			const BATCH_SIZE = 100;
			let successCount = 0;
			let failCount = 0;

			for (let i = 0; i < users.length; i += BATCH_SIZE) {
				const batch = users.slice(i, i + BATCH_SIZE);

				for (const userId of batch) {
					try {
						const result = await fetch(apiUrl('copyMessage', {
							from_chat_id: message.chat.id,
							message_id: message.reply_to_message.message_id,
							chat_id: parseInt(userId)
						}));

						const response = await result.json();
						if (response.ok) {
							successCount++;
						} else {
							failCount++;
						}
					} catch (error) {
						failCount++;
					}
				}

				if (i + BATCH_SIZE < users.length) {
					await new Promise(resolve => setTimeout(resolve, 100));
				}
			}

			await fetch(apiUrl('sendMessage', {
				chat_id: message.chat.id,
				text: `✅ پیام ارسال شد!\n\n📊 موفق: ${successCount}\n❌ ناموفق: ${failCount}\n📈 کل: ${users.length}`
			}));
			return;
		}
	}

	const membershipStatus = await checkAllChannelsMembership(message.from.id, db);
	if (!membershipStatus.allJoined) {
		await sendForceJoinMessage(message.chat.id, message.message_id, membershipStatus.notJoinedChannels, db);
		return;
	}

	const spamStatus = await checkSpamStatus(message.from.id, db);

	if (!spamStatus.allowed) {
		await sendSpamMessage(message.chat.id, message.message_id, spamStatus);

		if (spamStatus.shouldBan) {
			const ban = await getBanList(db);
			const userId = message.from.id.toString();
			if (!ban.includes(userId)) {
				ban.push(userId);
				await db.put("ban", ban.join("\n"));
				// Cache is already updated by reference

				await fetch(apiUrl('sendMessage', {
					chat_id: ADMIN,
					text: `🚫 کاربر ${message.from.first_name} (${userId}) به دلیل ${spamStatus.offenseCount} بار اسپم، دائماً بن شد!`
				}));
			}
		}
		return;
	}

	recordUserMessage(message.from.id);

	if (spamStatus.shouldWarn) {
		await sendSpamMessage(message.chat.id, message.message_id, spamStatus);
	}

	const ban = await getBanList(db);

	if (message.from.id != ADMIN) {
		await addUser(message.from.id, db);
	}

	if (message.from.id == ADMIN || !(ban.includes(message.from.id.toString()))) {
		if (message.from.id != ADMIN) {
			const replymarkup23 = JSON.stringify({
				inline_keyboard: [
					[
						{ text: message.chat.first_name, callback_data: message.chat.id + ':' + message.message_id },
						{ text: "اسم طرف", callback_data: message.chat.id + ':' + message.message_id }
					],
					[
						{ text: ((message.chat.last_name) || "هیچی"), callback_data: message.chat.id + ':' + message.message_id },
						{ text: "فامیل طرف", callback_data: message.chat.id + ':' + message.message_id }
					],
					[
						{ text: message.chat.id, callback_data: message.chat.id + ':' + message.message_id },
						{ text: "ایدی عددی طرف", callback_data: message.chat.id + ':' + message.message_id }
					],
					[{ text: "بن کردن کاربر", callback_data: "ban" }],
					[{ text: "رفتن به پیوی", url: ((message.chat.username && 't.me/' + message.chat.username) || 'tg://openmessage?user_id=' + message.chat.id) }]
				]
			});

			if ('reply_to_message' in message) {
				if (message.reply_to_message.from.id != message.from.id && !('reply_markup' in message.reply_to_message)) {
					await fetch(apiUrl('copyMessage', { from_chat_id: message.chat.id, message_id: message.message_id, chat_id: ADMIN, reply_markup: replymarkup23 }));
				} else {
					let reply;
					if (message.reply_to_message.from.id == message.from.id) {
						reply = message.reply_to_message.message_id + 1;
					} else {
						reply = message.reply_to_message.reply_markup.inline_keyboard[0][0].callback_data;
					}
					await fetch(apiUrl('copyMessage', { from_chat_id: message.chat.id, message_id: message.message_id, chat_id: ADMIN, reply_to_message_id: reply, reply_markup: replymarkup23 }));
				}
			} else {
				await fetch(apiUrl('copyMessage', { from_chat_id: message.chat.id, message_id: message.message_id, chat_id: ADMIN, reply_markup: replymarkup23 }));
			}
			await fetch(apiUrl('sendMessage', { chat_id: message.chat.id, text: "✅ ارسال شد", reply_to_message_id: message.message_id }));
		} else {
			if (message.reply_to_message && message.reply_to_message.from.id != message.from.id) {
				const id23 = message.reply_to_message.reply_markup.inline_keyboard[0][0].callback_data.split(":");
				const id223 = await fetch(apiUrl('copyMessage', {
					from_chat_id: message.chat.id,
					message_id: message.message_id,
					chat_id: id23[0],
					reply_to_message_id: id23[1],
					reply_markup: JSON.stringify({
						inline_keyboard: [[{ text: message.reply_to_message.from.first_name, callback_data: message.message_id }]]
					})
				}));
				const response23 = await id223.json();
				if (response23.description == "Forbidden: bot was blocked by the user") {
					await fetch(apiUrl('sendMessage', { chat_id: message.chat.id, text: "❌ ارسال نشد - کاربر ربات را مسدود کرده است", reply_to_message_id: message.message_id }));
				} else {
					await fetch(apiUrl('sendMessage', { chat_id: message.chat.id, text: "✅ ارسال شد", reply_to_message_id: message.message_id }));
				}
			}
		}
	}
	return new Response('Ok');
}

async function registerWebhook(request, requestUrl, suffix, secret) {
	TOKEN = globalThis.TOKEN;
	const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`;
	const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json();
	return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}

async function unRegisterWebhook(request) {
	TOKEN = globalThis.TOKEN;
	const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json();
	return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}

function apiUrl(methodName, params = null) {
	let query = '';
	if (params) {
		query = '?' + new URLSearchParams(params).toString();
	}
	return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`;
}

function apiPost(methodName, params = null) {
	return fetch(`https://api.telegram.org/bot${TOKEN}/${methodName}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: params ? JSON.stringify(params) : null
	});
}

if (typeof globalThis.TOKEN !== 'undefined') {
	TOKEN = globalThis.TOKEN;
	ADMIN = globalThis.ADMIN;
}
