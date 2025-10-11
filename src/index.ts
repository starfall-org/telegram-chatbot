import { Bot, Context, webhookCallback } from 'grammy';
import OpenAI from 'openai';
import { detector } from './feature';

export interface Env {
	KV_BINDING: KVNamespace;
	BOT_INFO: string;
	BOT_TOKEN: string;
	AI_BASE_URL: string;
	AI_API_KEY: string;
	AI_MODEL: string;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const bot = new Bot(env.BOT_TOKEN, { botInfo: JSON.parse(env.BOT_INFO) });

		bot.command('start', async (ctx: Context) => {
			await ctx.replyWithChatAction('typing');
			await ctx.reply(
				`Hello ${
					ctx.from!.first_name
				}! Welcome to Anti-Spam Enforcement Service Bot! Invite this bot to your group and make it an admin to help keep your group safe from spam. Use /help to see available commands.`
			);
		});

		bot.command('help', async (ctx) => {
			await ctx.replyWithChatAction('typing');
			await ctx.reply(`Available commands:
/start - Start the bot and see the welcome message.
/help - Show this help message.
/setRules - Set spam detection rules for the group (admin only).
/setLanguage - Set the language for spam detection (admin only).
/setPunishment - Set the punishment for detected spam (admin only).`);
		});

		bot.command('setRules').filter(
			async (ctx) => {
				const member = await ctx.getChatMember(ctx.from!.id);
				return member.status === 'administrator' || (member.status === 'creator' && ctx.chat.type !== 'private');
			},
			async (ctx) => {
				await ctx.replyWithChatAction('typing');
				const rules = ctx.message!.text.replace('/setRules', '').trim();
				if (!rules) {
					await ctx.reply('Please provide rules after the command. Example: /setRules <your rules here>');
					return;
				}
				await env.KV_BINDING.put(`rules_${ctx.chat.id}`, rules);
				await ctx.reply('Spam detection rules have been updated.');
			}
		);

		bot.command('setLanguage').filter(
			async (ctx) => {
				const member = await ctx.getChatMember(ctx.from!.id);
				return member.status === 'administrator' || (member.status === 'creator' && ctx.chat.type !== 'private');
			},
			async (ctx) => {
				await ctx.replyWithChatAction('typing');
				const language = ctx.message!.text.replace('/setLanguage', '').trim().toLowerCase();
				if (!language) {
					await ctx.reply('Please provide a language after the command. Example: /setLanguage english');
					return;
				}
				await env.KV_BINDING.put(`language_${ctx.chat.id}`, language);
				await ctx.reply(`Spam detection language has been set to ${language}.`);
			}
		);

		bot.command('setPunishment').filter(
			async (ctx) => {
				const member = await ctx.getChatMember(ctx.from!.id);
				return member.status === 'administrator' || (member.status === 'creator' && ctx.chat.type !== 'private');
			},
			async (ctx) => {
				await ctx.replyWithChatAction('typing');
				const punishment = ctx.message!.text.replace('/setPunishment', '').trim().toLowerCase();
				if (!['delete', 'mute', 'kick', 'ban'].includes(punishment)) {
					await ctx.reply(
						'Please provide a valid punishment after the command. Options are: delete, kick, ban. Example: /setPunishment delete'
					);
					return;
				}
				await env.KV_BINDING.put(`punishment_${ctx.chat.id}`, punishment);
				await ctx.reply(`Punishment for detected spam has been set to ${punishment}.`);
			}
		);

		bot.on('message').filter(
			async (ctx) => {
				return ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
			},
			async (ctx) => {
				const client = new OpenAI({
					baseURL: env.AI_BASE_URL,
					apiKey: env.AI_API_KEY,
				});
				const rules = (await env.KV_BINDING.get(`rules_${ctx.chat.id}`)) || 'No specific rules set, use general spam detection.';
				const language = (await env.KV_BINDING.get(`language_${ctx.chat.id}`)) || 'english';
				const punishment = (await env.KV_BINDING.get(`punishment_${ctx.chat.id}`)) || 'mute';
				const isAdmin = await ctx.getChatMember(ctx.from!.id).then((member) => ['administrator', 'creator'].includes(member.status));
				const isBotAdmin = await ctx.getChatMember(ctx.me.id).then((member) => ['administrator', 'creator'].includes(member.status));

				const messageText = ctx.message.text || ctx.message.caption || '';
				await ctx.replyWithChatAction('typing');
				if (!messageText) return;
				const detection = await detector(client, env.AI_MODEL, rules, language, [{ role: 'user', content: messageText }]);
				if (detection.isSpam) {
					const actions = [];
					if (isAdmin) {
						await ctx.reply(
							`Message from ${ctx.from!.first_name} is detected as spam. Reason: ${detection.reason} (not punished as sender is admin)`
						);
						return;
					}
				}
			}
		);

		return webhookCallback(bot, 'cloudflare-mod')(request);
	},
};
