import { OpenAI } from 'openai';

/**
 * This is a Cloudflare Workers application. It uses the `grammy` library to create a Telegram bot
 * and the `openai` library to interact with OpenAI's API for AI functionalities.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

async function aiChat(client: OpenAI, messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
	const response = await client.chat.completions.create({
		model: 'openai',
		messages: [
			{
				role: 'system',
				content:
					'Your name is AI Starfall, an AI assistant that helps users with a variety of tasks. You are friendly, knowledgeable, and always eager to assist. Keep your responses concise and to the point. If user want to download content from media platforms, tell them use bot @contentdownload_bot.',
			},
			...messages,
		],
	});
	return response.choices[0]?.message?.content;
}

export { aiChat };
