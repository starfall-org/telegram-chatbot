import { Bot, Context, webhookCallback } from 'grammy';

async function deleteMessage(ctx: Context) {
	try {
		await ctx.deleteMessage();
	} catch (error) {
		console.error('Error deleting message:', error);
	}
}

async function banUser(ctx: Context, userId: number, durationSeconds?: number) {
	try {
		if (durationSeconds && durationSeconds > 0) {
			await ctx.banChatMember(userId, { until_date: Math.floor(Date.now() / 1000) + durationSeconds });
		} else {
			await ctx.banChatMember(userId);
		}
	} catch (error) {
		console.error('Error banning user:', error);
	}
}

async function muteUser(ctx: Context, userId: number, durationSeconds?: number) {
	try {
		const untilDate = Math.floor(Date.now() / 1000) + (durationSeconds || 0);
		await ctx.restrictChatMember(
			userId,
			{
				can_send_messages: false,
			},
			{ until_date: untilDate }
		);
	} catch (error) {
		console.error('Error muting user:', error);
	}
}

async function unbanUser(ctx: Context, userId: number) {
	try {
		await ctx.unbanChatMember(userId);
	} catch (error) {
		console.error('Error unbanning user:', error);
	}
}

async function unmuteUser(ctx: Context, userId: number) {
	try {
		await ctx.restrictChatMember(userId, {
			can_send_messages: true,
			can_send_polls: true,
			can_send_other_messages: true,
			can_add_web_page_previews: true,
			can_change_info: false,
			can_invite_users: false,
			can_pin_messages: false,
		});
	} catch (error) {
		console.error('Error unmuting user:', error);
	}
}

async function kickUser(ctx: Context, userId: number) {
	try {
		await ctx.banChatMember(userId);
		await ctx.unbanChatMember(userId);
	} catch (error) {
		console.error('Error kicking user:', error);
	}
}

export { deleteMessage, banUser, muteUser, unbanUser, unmuteUser, kickUser };
