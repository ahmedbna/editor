import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getChatByIdOrUrlIdEnsuringAccess } from './messages';
import { getCurrentUser } from './users';

export const recordDeploy = mutation({
  args: {
    id: v.string(),
  },
  handler: async (ctx, { id }) => {
    const user = await getCurrentUser(ctx);
    const chat = await getChatByIdOrUrlIdEnsuringAccess(ctx, { id, userId: user._id });
    if (!chat) {
      throw new ConvexError('Chat not found');
    }
    await ctx.db.patch(chat._id, { hasBeenDeployed: true });
  },
});

export const hasBeenDeployed = query({
  args: {
    id: v.string(),
  },
  handler: async (ctx, { id }) => {
    const user = await getCurrentUser(ctx);
    const chat = await getChatByIdOrUrlIdEnsuringAccess(ctx, { id, userId: user._id });
    if (!chat) {
      throw new ConvexError('Chat not found');
    }
    return !!chat.hasBeenDeployed;
  },
});
