/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { Bot, Context, webhookCallback } from 'grammy';
import OpenAI from 'openai';
import { detectSpamWithAI, aiChat } from './feature';

export interface Env {
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace;
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	// MY_BUCKET: R2Bucket;
	//
	// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
	// MY_SERVICE: Fetcher;
	//
	// Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
	// MY_QUEUE: Queue;
	KV_BINDING: KVNamespace;
	BOT_INFO: string;
	BOT_TOKEN: string;
	AI_BASE_URL: string;
	AI_API_KEY: string;
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
			await ctx.reply('Welcome to AI Starfall! How can I help you?');
		});

		bot.command('help', async (ctx) => {
			await ctx.replyWithChatAction('typing');
			await ctx.reply(`Here are some commands you can try:\n\n/resetStorage - Reset your chat history.`);
		});

		bot.command('resetStorage', async (ctx) => {
			await ctx.replyWithChatAction('typing');
			if (ctx.chat.type === 'private') {
				await env.KV_BINDING.delete(`${ctx.chat.id}`);
				await ctx.reply('Your chat history has been reset.');
			} else {
				await ctx.reply('The /resetStorage command can only be used in private chats.');
			}
		});
		bot.on('message').filter(
			async (ctx) => {
				return ctx.from?.id !== bot.botInfo.id && ctx.chat.type !== 'private';
			},
			async (ctx) => {
				const messageText = ctx.message.text || ctx.message.caption || '';
				const { is_spam, reason } = await detectSpamWithAI(client, messageText);

				if (is_spam === true) {
					try {
						// Load chat history to provide context for AI response
						const chatHistoryString = (await env.KV_BINDING.get(`${ctx.chat.id}`)) || '[]';
						const chatHistory = JSON.parse(chatHistoryString);

						// Use sender chat title if present (channel post), otherwise the user's first name
						const senderName = ctx.senderChat?.title || ctx.from?.first_name || 'Unknown';
						// Add the spam message to history for context
						const userMessage = `${senderName}: ${messageText}`;
						chatHistory.push({ role: 'user', content: userMessage });

						// Check if bot has admin permissions in group/supergroup
						if (ctx.message.chat.type === 'group' || ctx.message.chat.type === 'supergroup') {
							const botMember = await ctx.getChatMember(ctx.me.id);
							const canDelete = botMember.status === 'administrator' && botMember.can_delete_messages;
							const canBan = botMember.status === 'administrator' && botMember.can_restrict_members;
							// If the message is sent on behalf of a channel (sender_chat), ctx.from may be undefined.
							let isAdmin = false;
							if (ctx.from?.id) {
								const senderMember = await ctx.getChatMember(ctx.from.id);
								isAdmin = senderMember.status === 'administrator' || senderMember.status === 'creator';
							}

							let actionTaken = '';
							// Only delete and ban if the sender is not an admin and bot has ban permission
							if (canDelete) {
								await ctx.deleteMessage();
								console.log('Deleted message', { chatId: ctx.chat.id, messageId: ctx.message.message_id, fromId: ctx.from.id });
								actionTaken = 'deleted the message';
							}
							if (!isAdmin && canBan && ctx.from?.id) {
								await ctx.banChatMember(ctx.from.id);
								console.log('Banned user', { chatId: ctx.chat.id, userId: ctx.from.id });
								actionTaken += actionTaken ? ' and banned the user' : 'banned the user';
							} else if (isAdmin) {
								actionTaken = 'detected spam from admin (no action taken)';
							} else {
								actionTaken = 'no more action taken (insufficient permissions)';
							}

							// Generate AI response about the action taken
							const quoteMessage = messageText.length > 100 ? messageText.slice(0, 100) + '...' : ctx.message.text;
							const aiResponse =
								`>${quoteMessage}\n\n` + `*User:* *"${ctx.from.first_name}"*.\n*Bot Action:* ${actionTaken}.\n*Reason:* ${reason}`;
							const notif = await bot.api.sendMessage(ctx.chat.id, aiResponse, { parse_mode: 'Markdown' });
							console.log('Sent moderation notification', { chatId: ctx.chat.id, notifMessageId: (notif as any)?.message_id });
							chatHistory.push({ role: 'assistant', content: aiResponse });
							await env.KV_BINDING.put(`${ctx.chat.id}`, JSON.stringify(chatHistory));
						}
					} catch (error) {
						console.error('Error handling spam:', error);
					}
				}
			}
		);

		bot.on('message:text').filter(
			async (ctx) => {
				const botUsername = bot.botInfo.username;
				return (
					ctx.message.text.includes(`@${botUsername}`) ||
					ctx.message.chat.type === 'private' ||
					ctx.message.reply_to_message?.from?.username === ctx.me.username
				);
			},
			async (ctx) => {
				const messageText = ctx.message.text;

				await ctx.replyWithChatAction('typing');
				const chatHistoryString = (await env.KV_BINDING.get(`${ctx.chat.id}`)) || '[]';
				const chatHistory = JSON.parse(chatHistoryString);
				if (chatHistory.length > 50) {
					chatHistory.shift();
				}
				const userMessage = `${ctx.senderChat?.title || ctx.from.first_name}: ${messageText}`;
				chatHistory.push({ role: 'user', content: userMessage });
				const aiReply = await aiChat(client, chatHistory);

				if (aiReply) {
					await ctx.reply(aiReply);
					chatHistory.push({ role: 'assistant', content: aiReply });
					await env.KV_BINDING.put(`${ctx.chat.id}`, JSON.stringify(chatHistory));
				} else {
					await ctx.reply("I'm sorry, I couldn't generate a response at this time.");
				}
			}
		);

		return webhookCallback(bot, 'cloudflare-mod')(request);
	},
};
