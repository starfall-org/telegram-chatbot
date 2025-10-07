import OpenAI from 'openai';
import { deleteMessage, banUser, muteUser, unbanUser, unmuteUser, kickUser } from './func_tools';
import { Context } from 'grammy';

async function aiChat(ctx: Context, client: OpenAI, messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
	const response = await client.chat.completions.create({
		model: 'gpt-4.1-mini:free',
		messages: [
			{
				role: 'system',
				content: `Your name is AI Starfall, an AI assistant that helps users with a variety of tasks. You are friendly, knowledgeable, and always eager to assist. Keep your responses concise and to the point.

* You are a spam detection system. Analyze the message and determine if it contains spam, advertising, or promotional content.
					
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
-> Calling banUser, muteUser function for punishment and then calling deleteMessage function to remove the spam message. You will decide the duration of ban/mute based on the severity of the spam message.

* Generate a brief, professional message to inform the group about spam detection and moderation actions taken. Keep the message:
- Brief and to the point (1-2 sentences)
- Professional but friendly
- Include a warning emoji (⚠️)
- Mention the user's name
- Explain what action was taken (or that you lack permissions).`,
			},
			...messages,
		],
		tools: [
			{
				type: 'function',
				name: 'deleteMessage',
				description: 'Delete a spam message from the chat.',
			},
			{
				type: 'function',
				name: 'banUser',
				description: 'Ban a user by ID from the chat permanently or temporarily based on the specified duration.',
				parameters: {
					type: 'object',
					properties: {
						userId: { type: 'integer', description: 'The unique identifier of the user to ban.' },
						durationSeconds: { type: 'integer', description: 'Duration of the ban in seconds (for temporary bans).' },
					},
					required: ['userId'],
				},
			},

			{
				type: 'function',
				name: 'unbanUser',
				description: 'Unban a previously banned user from the chat.',
				parameters: {
					type: 'object',
					properties: {
						userId: { type: 'integer', description: 'The unique identifier of the user to unban.' },
					},
					required: ['userId'],
				},
			},
			{
				type: 'function',
				name: 'muteUser',
				description: 'Mute a user in the chat by their user ID for a specified duration.',
				parameters: {
					type: 'object',
					properties: {
						userId: { type: 'integer', description: 'The unique identifier of the user to mute.' },
						durationSeconds: { type: 'integer', description: 'Duration of the mute in seconds (for temporary mutes).' },
					},
					required: ['userId'],
				},
			},
			{
				type: 'function',
				name: 'unmuteUser',
				description: 'Unmute a previously muted user in the chat by their user ID.',
				parameters: {
					type: 'object',
					properties: {
						userId: { type: 'integer', description: 'The unique identifier of the user to unmute.' },
					},
					required: ['userId'],
				},
			},
			{
				type: 'function',
				name: 'kickUser',
				description: 'Kick a user from the chat by their user ID.',
				parameters: {
					type: 'object',
					properties: {
						userId: { type: 'integer', description: 'The unique identifier of the user to kick.' },
					},
					required: ['userId'],
				},
			},
		],
	});
	const funcTools = {
		deleteMessage,
		banUser,
		unbanUser,
		muteUser,
		unmuteUser,
		kickUser,
	};
	let toolCallResponse = {
		tool_call_id: '',
		role: '',
		name: '',
		content: '',
	};
	const choice = response.choices[0];
	if (choice.message.tool_calls) {
		for (const toolCall of choice.message.tool_calls) {
			if (toolCall.type !== 'function' || !toolCall['function']) continue;
			const funcName = toolCall.function.name;
			const funcArgs = JSON.parse(toolCall.function.arguments);
			if (funcName in funcTools) {
				let result;
				try {
					//@ts-ignore
					result = await funcTools[funcName](ctx, ...Object.values(funcArgs));
				} catch (error) {
					result = String(error);
				}
				toolCallResponse = {
					tool_call_id: toolCall.id,
					role: 'function',
					name: funcName,
					content: `Function ${funcName} executed successfully. Result: ${result || 'No result returned'}`,
				};
				break;
			}
		}
	}
	return { content: response.choices[0]?.message?.content, toolCallResponse };
}

export { aiChat };
