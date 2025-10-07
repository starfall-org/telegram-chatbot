import { Bot, Context, webhookCallback } from 'grammy';
import OpenAI from 'openai';
import { aiChat } from './features';
import { Env } from './types';

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

		bot.on('message:text', async (ctx) => {
			const botUsername = bot.botInfo.username;
			const messageText = ctx.message.text;

			if (ctx.message.from?.is_bot || ctx.message.from?.id === ctx.me.id || (ctx.message as any).via_bot?.id === ctx.me.id) return;

			// Initialize OpenAI client
			const client = new OpenAI({
				baseURL: env.AI_BASE_URL,
				apiKey: env.AI_API_KEY,
			});

			await ctx.replyWithChatAction('typing');
			const chatHistoryString = (await env.KV_BINDING.get(`${ctx.chat.id}`)) || '[]';
			const chatHistory = JSON.parse(chatHistoryString);
			if (chatHistory.length > 50) {
				chatHistory.shift();
			}

			const userMessage = `${ctx.senderChat?.title || ctx.from.first_name} (${ctx.from.id}): ${messageText}`;
			chatHistory.push({ role: 'user', content: userMessage });

			const { content, toolCallResponse } = await aiChat(ctx, client, chatHistory);

			if (
				messageText.startsWith('/') ||
				(!messageText.includes(botUsername) &&
					ctx.message.chat.type !== 'private' &&
					ctx.message.reply_to_message?.from?.username !== botUsername)
			) {
				if (content && toolCallResponse.tool_call_id) {
					await ctx.reply(content);
					chatHistory.push(toolCallResponse);
					chatHistory.push({ role: 'assistant', content: content });
					await env.KV_BINDING.put(`${ctx.chat.id}`, JSON.stringify(chatHistory));
				} else {
					await ctx.reply("I'm sorry, I couldn't generate a response at this time.");
				}
			} else {
				if (content) {
					await ctx.reply(content);
					if (toolCallResponse.tool_call_id) {
						chatHistory.push(toolCallResponse);
					}
					chatHistory.push({ role: 'assistant', content: content });
					await env.KV_BINDING.put(`${ctx.chat.id}`, JSON.stringify(chatHistory));
				} else {
					await ctx.reply("I'm sorry, I couldn't generate a response at this time.");
				}
			}
		});

		return webhookCallback(bot, 'cloudflare-mod')(request);
	},
};
