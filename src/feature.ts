import { OpenAI } from 'openai';

/**
 * This is a Cloudflare Workers application. It uses the `grammy` library to create a Telegram bot
 * and the `openai` library to interact with OpenAI's API for AI functionalities.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

async function detectSpamWithAI(client: OpenAI, messageText: string): Promise<{ is_spam: boolean; reason?: string }> {
	try {
		const response = await client.responses.create({
			model: 'gpt-4.1-mini:free',
			instructions: `You are a spam detection system. Analyze the message and determine if it contains spam, advertising, or promotional content.
					
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

Respond with this format:
- In the first line: respond with "YES" if it's spam, or "NO" if it's legitimate content.
- From second line: A brief explanation of your reasoning.`,
			input: messageText,
		});

		const resp = response.output_text.trim();
		const result = resp?.split('\n')[0].trim().toUpperCase();
		const reason = resp?.replace(result!, '').trim() || 'No reason provided';
		return { is_spam: result === 'YES', reason };
	} catch (error) {
		console.error('Error detecting spam with AI:', error);
		return { is_spam: false, reason: 'Failed to detect spam with AI' }; // If AI fails, don't block the message
	}
}

async function aiChat(client: OpenAI, messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
	const response = await client.chat.completions.create({
		model: 'gpt-4.1-mini:free',
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

export { detectSpamWithAI, aiChat };
