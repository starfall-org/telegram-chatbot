import { OpenAI } from 'openai';

/**
 * This is a Cloudflare Workers application. It uses the `grammy` library to create a Telegram bot
 * and the `openai` library to interact with OpenAI's API for AI functionalities.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export async function detector(
	client: OpenAI,
	model: string,
	rules: string,
	language: string,
	message: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
) {
	const response = await client.chat.completions.create({
		model: model,
		messages: [
			{
				role: 'system',
				content:
					'You are Anti-Spam Enforcement Service. Your task is to analyze messages and determine if they are spam based on the provided rules. ' +
					`Here are the rules to consider:\n` +
					rules +
					`\n\nRespond format:\nYES or NO\nREASON: <reason in ${language}>\n`,
			},
			...message,
		],
	});
	const isSpam = response.choices[0].message?.content?.split('\n')[0].trim().toUpperCase() === 'YES';
	const reason = response.choices[0].message?.content?.split('\n')[1]?.replace('REASON:', '').trim() || 'No reason provided';
	return { isSpam, reason };
}
