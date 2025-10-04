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
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	// MY_KV_NAMESPACE: KVNamespace;
	//
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
	KV: KVNamespace;
	BOT_INFO: string;
	BOT_TOKEN: string;
	BASE_URL: string;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const bot = new Bot(env.BOT_TOKEN, { botInfo: JSON.parse(env.BOT_INFO) });

		bot.command('start', async (ctx: Context) => {
			await ctx.replyWithChatAction('typing');
			await ctx.reply('Welcome to AI Starfall! How can I help you?');
		});

		bot.on('message:text', async (ctx) => {
			await ctx.replyWithChatAction('typing');
			const chatHistoryString = (await env.KV.get(`${ctx.chat.id}`)) || '[]';
			const chatHistory = JSON.parse(chatHistoryString);
			if (chatHistory.length > 20) {
				chatHistory.shift();
			}
			const userMessage = `${ctx.senderChat?.title || ctx.from.first_name}: ${ctx.message.text}`;
			const botUsername = bot.botInfo.username;
			if (
				userMessage.startsWith('/') ||
				(!userMessage.includes(botUsername) &&
					ctx.message.chat.type !== 'private' &&
					ctx.message.reply_to_message?.from?.username !== botUsername)
			) {
				return;
			}
			chatHistory.push({ role: 'user', content: userMessage });
			const client = new OpenAI({
				baseURL: env.BASE_URL,
				apiKey: '',
			});
			const aiReply = await aiChat(client, chatHistory);

			if (aiReply) {
				await ctx.reply(aiReply);
				chatHistory.push({ role: 'assistant', content: aiReply });
				await env.KV.put(`${ctx.chat.id}`, JSON.stringify(chatHistory));
			} else {
				await ctx.reply("I'm sorry, I couldn't generate a response at this time.");
			}
		});

		return webhookCallback(bot, 'cloudflare-mod')(request);
	},
};

async function aiChat(client: OpenAI, messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
	const response = await client.chat.completions.create({
		model: 'RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8',
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
