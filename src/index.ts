import { Bot, Context, webhookCallback } from 'grammy';
import { detector } from './detector';
import { ChatMemberAdministrator } from 'grammy/types';
import OpenAI from 'openai';

export interface Env {
	KV_BINDING: KVNamespace;
	BOT_INFO: string;
	BOT_TOKEN: string;
	AI_BASE_URL: string;
	AI_API_KEY: string;
	AI_MODEL: string;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const bot = new Bot(env.BOT_TOKEN, { botInfo: JSON.parse(env.BOT_INFO) });
		const client = new OpenAI({
			baseURL: env.AI_BASE_URL,
			apiKey: env.AI_API_KEY,
		});

		bot.command('start', async (ctx: Context) => {
			await ctx.replyWithChatAction('typing');
			await ctx.reply(
				`Hello *${
					ctx.from!.first_name
				}*.\n\nWelcome to *Anti-Spam Enforcement Service Bot*.\nInvite this bot to your group and make it an admin to help keep your group safe from spam. Use /help to see available commands.`,
				{ parse_mode: 'Markdown' }
			);

			const userHistoryString = (await env.KV_BINDING.get(`user_${ctx.from!.id}`)) || '[]';
			const userHistory = JSON.parse(userHistoryString) as Array<{
				chatTitle: string;
				chatId: number;
				timestamp: number;
				punishment: string;
				content: string;
				reason: string;
				handled: boolean;
			}>;
			if (userHistory.length > 0) {
				userHistory.slice(-5).forEach((entry) => {
					ctx.reply(
						`In group ID ${entry.chatId}, on ${new Date(entry.timestamp).toLocaleString()}, you were marked for "${
							entry.reason
						}" and received a "${entry.punishment}" punishment for the message: "${entry.content}"` +
							'\nIf you believe this was a mistake, please follow the below steps:' +
							'\n1. *Report to Group Admin:* I will contact the group admin to investigate the issue.' +
							'\n2. *Request to StarChatter:* You can reach out to StarChatter for verify that message is not spam and I will remove the punishment.',
						{
							parse_mode: 'Markdown',
							reply_markup: {
								inline_keyboard: [
									[{ text: 'Report to Group Admin', callback_data: `report_${ctx.from!.id}_${entry.chatId}` }],
									[{ text: 'Request to StarChatter', url: `https://t.me/StarChatterBot?start=_tgr_g267HSQzMDZl` }],
								],
							},
						}
					);
				});
			}
		});

		bot.command('help', async (ctx) => {
			await ctx.replyWithChatAction('typing');
			await ctx.reply(
				`*Available commands:*

/start - Start the bot and see the welcome message.
/help - Show this help message.
/setRules - Set spam detection rules for the group (admin only).
/setLanguage - Set the language for spam detection (admin only).
/setPunishment - Set the punishment for detected spam (admin only).`,
				{ parse_mode: 'Markdown' }
			);
		});

		bot.command('setRules').filter(
			async (ctx) => {
				const member = await ctx.getChatMember(ctx.from!.id);
				return member.status === 'administrator' || (member.status === 'creator' && ctx.chat.type !== 'private');
			},
			async (ctx) => {
				await ctx.replyWithChatAction('typing');
				const rules = ctx.message!.text.replace('/setRules', '').trim();
				if (!rules) {
					await ctx.reply('Please provide rules after the command. Example: /setRules <your rules here>');
					return;
				}
				await env.KV_BINDING.put(`rules_${ctx.chat.id}`, rules);
				await ctx.reply('Spam detection rules have been updated.');
			}
		);

		bot.command('setLanguage').filter(
			async (ctx) => {
				const member = await ctx.getChatMember(ctx.from!.id);
				return member.status === 'administrator' || (member.status === 'creator' && ctx.chat.type !== 'private');
			},
			async (ctx) => {
				await ctx.replyWithChatAction('typing');
				const language = ctx.message!.text.replace('/setLanguage', '').trim().toLowerCase();
				if (!language) {
					await ctx.reply('Please provide a language after the command. Example: /setLanguage english');
					return;
				}
				await env.KV_BINDING.put(`language_${ctx.chat.id}`, language);
				await ctx.reply(`Spam detection language has been set to ${language}.`);
			}
		);

		bot.command('setPunishment').filter(
			async (ctx) => {
				const member = await ctx.getChatMember(ctx.from!.id);
				return member.status === 'administrator' || (member.status === 'creator' && ctx.chat.type !== 'private');
			},
			async (ctx) => {
				await ctx.replyWithChatAction('typing');
				const punishment = ctx.message!.text.replace('/setPunishment', '').trim().toLowerCase();
				if (!['delete', 'mute', 'kick', 'ban'].includes(punishment)) {
					await ctx.reply(
						'Please provide a valid punishment after the command. Options are: delete, kick, ban. Example: /setPunishment delete'
					);
					return;
				}
				await env.KV_BINDING.put(`punishment_${ctx.chat.id}`, punishment);
				await ctx.reply(`Punishment for detected spam has been set to ${punishment}.`);
			}
		);

		bot.command('test', async (ctx) => {
			await ctx.replyWithChatAction('typing');
			const text = ctx.message!.text.replace('/test', '').trim();
			const detection = await detector(client, env.AI_MODEL, 'No specific rules set, use general spam detection.', 'english', [
				{ role: 'user', content: text || 'Congratulations! You have won a free iPhone! Click here to claim your prize.' },
			]);
			await ctx.reply(`Is Spam: ${detection.isSpam}\nReason: ${detection.reason}`);
		});

		bot.on('message').filter(
			async (ctx) => {
				return ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
			},
			async (ctx) => {
				const rules = (await env.KV_BINDING.get(`rules_${ctx.chat.id}`)) || 'No specific rules set, use general spam detection.';
				const language = (await env.KV_BINDING.get(`language_${ctx.chat.id}`)) || 'english';
				const punishment = (await env.KV_BINDING.get(`punishment_${ctx.chat.id}`)) || 'mute';
				const isAdmin = await ctx.getChatMember(ctx.from!.id).then((member) => ['administrator', 'creator'].includes(member.status));
				const isBotAdmin = await ctx.getChatMember(ctx.me.id).then((member) => ['administrator', 'creator'].includes(member.status));
				const canRestrictMembers = isBotAdmin
					? await ctx.getChatMember(ctx.me.id).then((member) => {
							const admin = member as ChatMemberAdministrator;
							return admin.can_restrict_members;
					  })
					: false;
				const canDeleteMessages = isBotAdmin
					? await ctx.getChatMember(ctx.me.id).then((member) => (member as ChatMemberAdministrator).can_delete_messages)
					: false;

				const messageText = ctx.message.text || ctx.message.caption || '';
				await ctx.replyWithChatAction('typing');
				if (!messageText) return;
				const detection = await detector(client, env.AI_MODEL, rules, language, [{ role: 'user', content: messageText }]);
				if (detection.isSpam) {
					const actions = [];
					if (canDeleteMessages) {
						await ctx.deleteMessage();
						actions.push('deleted the message');
					}

					if (isAdmin) {
						actions.push('but took no further action since the user is an admin');
					} else {
						if (punishment === 'ban' && canRestrictMembers) {
							await ctx.banChatMember(ctx.from!.id);
							actions.push('banned the user');
						}
						if (punishment === 'kick' && canRestrictMembers) {
							await ctx.banChatMember(ctx.from!.id);
							await ctx.unbanChatMember(ctx.from!.id, { only_if_banned: true });
							actions.push('kicked the user');
						}
						if (punishment === 'mute' && canRestrictMembers) {
							await ctx.restrictChatMember(ctx.from!.id, {
								can_send_messages: false,
							});
							actions.push('muted the user');
						}

						if (['ban', 'mute'].includes(punishment) && canRestrictMembers && ctx.from!.id) {
							const userHistoryString = (await env.KV_BINDING.get(`user_${ctx.from!.id}`)) || '[]';
							const userHistory = JSON.parse(userHistoryString) as Array<{
								chatTitle: string;
								chatId: number;
								timestamp: number;
								punishment: string;
								content: string;
								reason: string;
								handled: boolean;
							}>;
							userHistory.push({
								chatTitle: ctx.chat.title!,
								chatId: ctx.chat.id,
								timestamp: Date.now(),
								punishment,
								content: messageText,
								reason: detection.reason,
								handled: false,
							});
							await env.KV_BINDING.put(`user_${ctx.from!.id}`, JSON.stringify(userHistory));
						}

						try {
							await ctx.api.sendMessage(
								ctx.from!.id,
								`In group ID ${ctx.chat.id}, on ${new Date().toLocaleString()}, you were marked for "${
									detection.reason
								}" and received a "${punishment}" punishment for the message: "${messageText}"` +
									'\nIf you believe this was a mistake, please follow the below steps:' +
									'\n1. *Report to Group Admin:* I will contact the group admin to investigate the issue.' +
									'\n2. *Request to StarChatter:* You can reach out to StarChatter for verify that message is not spam and I will remove the punishment.',
								{
									parse_mode: 'Markdown',
									reply_markup: {
										inline_keyboard: [
											[{ text: 'Report to Group Admin', callback_data: `report_${ctx.from!.id}_${ctx.chat.id}` }],
											[{ text: 'Request to StarChatter', url: `https://t.me/StarChatterBot?start=_tgr_g267HSQzMDZl` }],
										],
									},
								}
							);
						} catch (e) {
							console.log(e);
						}
					}

					await ctx.reply(
						`*Report:* User ${ctx.from!.first_name} (${ctx.from!.id}) was detected as spam and the bot ${actions.join(', ')}.`,
						{
							parse_mode: 'Markdown',
							reply_markup: { inline_keyboard: [[{ text: 'Report', url: `https://t.me/${ctx.me.username}?start=_tgr_5jNmpmUwZWRl` }]] },
						}
					);
				}
			}
		);

		bot.on('callback_query', async (ctx) => {
			const data = ctx.callbackQuery.data;
			if (data && data.startsWith('report_')) {
				const parts = data.split('_');
				if (parts.length === 3) {
					const userId = parseInt(parts[1]);
					const chatId = parseInt(parts[2]);
					const userHistoryString = (await env.KV_BINDING.get(`user_${userId}`)) || '[]';
					const userHistory = JSON.parse(userHistoryString) as Array<{
						chatTitle: string;
						chatId: number;
						timestamp: number;
						punishment: string;
						content: string;
						reason: string;
						handled: boolean;
					}>;
					const chatTitle = userHistory.find((entry) => entry.chatId === chatId)?.chatTitle;
					if (!isNaN(userId) && !isNaN(chatId)) {
						try {
							const chatAdmins = await ctx.api.getChatAdministrators(chatId);
							let notKnowAdmins = [];
							let knownAdmins = [];
							for (const admin of chatAdmins) {
								if (['administrator', 'creator'].includes(admin.status)) {
									try {
										await ctx.api.sendMessage(
											admin.user.id,
											`User ${ctx.from!.first_name} (${
												ctx.from!.username || ctx.from!.id
											}) has reported to you that they believe they were mistakenly punished in your group (${
												chatTitle || chatId
											}). Please review the case.`
										);
										knownAdmins.push(admin);
									} catch (e) {
										console.log(e);
										notKnowAdmins.push(admin);
									}
								}
							}

							if (notKnowAdmins.length === chatAdmins.length) {
								await ctx.api.sendMessage(
									ctx.from!.id,
									`Sorry, I couldn't contact any admins in the group (ID: ${chatId}) because they haven't started a chat with me. Please use second method.`
								);
							} else {
								let adminNames = knownAdmins.map((admin) => admin.user.first_name).join(', ');
								await ctx.api.sendMessage(
									ctx.from!.id,
									`I've notified ${adminNames.length} group admins about your report. They will review the case and take appropriate action. Thank you for helping keep the community safe!`
								);
							}
						} catch (e) {}
					} else {
					}
				} else {
				}
			}
		});

		return webhookCallback(bot, 'cloudflare-mod')(request);
	},
};
