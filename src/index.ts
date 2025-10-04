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
	BOT_INFO: string;
	BOT_TOKEN: string;
}

const client = new OpenAI({
	baseURL: 'https://orgcontributor--vllm-serve.modal.run/v1',
	apiKey: '',
});

async function aiChat(text: string) {
	const response = await client.responses.create({
		model: 'RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8',
		instructions:
			'Your name is AI Starfall, an AI assistant that helps users with a variety of tasks. You are friendly, knowledgeable, and always eager to assist. Keep your responses concise and to the point.',
		input: text,
	});
	return response.output_text;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const bot = new Bot(env.BOT_TOKEN, { botInfo: JSON.parse(env.BOT_INFO) });

		bot.command('start', async (ctx: Context) => {
			await ctx.replyWithChatAction('typing');
			await ctx.reply(
				'Welcome to AI Starfall!\n\nCurrently, the bot can not remember previous conversations. Please ask your questions directly.'
			);
		});

		bot.on('message:text', async (ctx) => {
			await ctx.replyWithChatAction('typing');
			const userMessage = ctx.message.text;
			const botUsername = bot.botInfo.username;
			if (
				userMessage.startsWith('/') ||
				(!userMessage.includes(botUsername) &&
					ctx.message.chat.type !== 'private' &&
					ctx.message.reply_to_message?.from?.username !== botUsername)
			) {
				// Ignore commands
				return;
			}
			const aiReply = await aiChat(userMessage);

			if (aiReply) {
				await ctx.reply(aiReply);
			} else {
				await ctx.reply("I'm sorry, I couldn't generate a response at this time.");
			}
		});

		return webhookCallback(bot, 'cloudflare-mod')(request);
	},
};
