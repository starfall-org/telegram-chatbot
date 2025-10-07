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

		bot.on('message:text').filter(
			async (ctx) => {
				return ctx.from?.is_bot === false && !ctx.message.text.startsWith('/');
			},
			async (ctx) => {
				const botUsername = bot.botInfo.username;
				const messageText = ctx.message.text;

				// Create OpenAI client for spam detection and chat
				const client = new OpenAI({
					baseURL: env.AI_BASE_URL,
					apiKey: env.AI_API_KEY,
				});

				// Check for spam/advertising using AI
				let isSpam = false;
				if (ctx.chat.type !== 'private') {
					isSpam = await detectSpamWithAI(client, messageText);
				}

				if (isSpam) {
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
							if (!isAdmin && canBan && ctx.from?.id) {
								if (canDelete) {
									await ctx.deleteMessage();
									console.log('Deleted message', { chatId: ctx.chat.id, messageId: ctx.message.message_id, fromId: ctx.from.id });
									actionTaken = 'deleted the message';
								}
								await ctx.banChatMember(ctx.from.id);
								console.log('Banned user', { chatId: ctx.chat.id, userId: ctx.from.id });
								actionTaken += actionTaken ? ' and banned the user' : 'banned the user';
							} else if (isAdmin) {
								actionTaken = 'detected spam from admin (no action taken)';
							} else {
								actionTaken = 'lacks permission to take action';

								// Generate AI response about the action taken
								const aiResponse = await generateSpamResponseWithAI(
									client,
									senderName,
									actionTaken || 'detected spam but lacks permissions to take action',
									canDelete || canBan
								);
								const notif = await ctx.reply(aiResponse);
								console.log('Sent moderation notification', { chatId: ctx.chat.id, notifMessageId: (notif as any)?.message_id });
								chatHistory.push({ role: 'assistant', content: aiResponse });
								await env.KV_BINDING.put(`${ctx.chat.id}`, JSON.stringify(chatHistory));
							}
						}
					} catch (error) {
						console.error('Error handling spam:', error);
					}
					return;
				}

				if (
					!ctx.message.text.includes(`@${botUsername}`) &&
					ctx.message.chat.type !== 'private' &&
					ctx.message.reply_to_message?.from?.username !== ctx.me.username
				)
					return;

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

async function generateSpamResponseWithAI(client: OpenAI, userName: string, actionTaken: string, hasPermissions: boolean): Promise<string> {
	try {
		const response = await client.chat.completions.create({
			model: 'gpt-4.1-mini:free',
			messages: [
				{
					role: 'system',
					content: `You are AI Starfall, a helpful AI assistant. Generate a brief, professional message to inform the group about spam detection and moderation actions taken.
					
Keep the message:
- Brief and to the point (1-2 sentences)
- Professional but friendly
- Include a warning emoji (⚠️)
- Mention the user's name
- Explain what action was taken (or that you lack permissions)`,
				},
				{
					role: 'user',
					content: `Generate a message informing that spam was detected from user "${userName}". Action taken: ${actionTaken}. ${
						hasPermissions ? 'I have permissions and took action.' : 'I do not have sufficient permissions.'
					}`,
				},
			],
			temperature: 0.7,
			max_tokens: 100,
		});

		return response.choices[0]?.message?.content || '⚠️ Spam detected and handled.';
	} catch (error) {
		console.error('Error generating spam response with AI:', error);
		// Fallback message if AI fails
		return `⚠️ Spam detected from ${userName}. ${actionTaken}.`;
	}
}

async function detectSpamWithAI(client: OpenAI, messageText: string): Promise<boolean> {
	try {
		const response = await client.chat.completions.create({
			model: 'gpt-4.1-mini:free',
			messages: [
				{
					role: 'system',
					content: `You are a spam detection system. Analyze the message and determine if it contains spam, advertising, or promotional content.
					
Consider the following as spam:
- Promotional/advertising content
- Links to dubious websites or shortened URLs
- Get-rich-quick schemes
- Casino/gambling promotions
- Cryptocurrency scams
- Adult/inappropriate content advertisements
- Repetitive messages with links
- Excessive use of emojis with promotional intent
- Messages trying to sell products or services

Respond with ONLY "YES" if it's spam, or "NO" if it's legitimate content. Do not provide any explanation.`,
				},
				{
					role: 'user',
					content: messageText,
				},
			],
			temperature: 0.1,
			max_tokens: 10,
		});

		const result = response.choices[0]?.message?.content?.trim().toUpperCase();
		return result === 'YES';
	} catch (error) {
		console.error('Error detecting spam with AI:', error);
		return false; // If AI fails, don't block the message
	}
}

async function aiChat(client: OpenAI, messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
	const response = await client.chat.completions.create({
		model: 'gpt-4.1-mini:free',
		messages: [
			{
				role: 'system',
				content:
					'Your name is AI Starfall, an AI assistant that helps users with a variety of tasks. You are friendly, knowledgeable, and always eager to assist. Keep your responses concise and to the point.',
			},
			...messages,
		],
	});
	return response.choices[0]?.message?.content;
}
