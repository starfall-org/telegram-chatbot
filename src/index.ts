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

		bot.on('message:text').filter(
			async (ctx) => {
				const botUsername = ctx.me.username;
				return (
					ctx.message.text.includes(`@${botUsername}`) ||
					ctx.message.chat.type === 'private' ||
					ctx.message.reply_to_message?.from?.id === ctx.me.id
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
				const userMessage = `USER: ${ctx.senderChat?.title || ctx.from.first_name}.\nMESSAGE: ${messageText}`;
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
