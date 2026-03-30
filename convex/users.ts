// convex/users.ts
import { ConvexError } from 'convex/values';
import { query, type QueryCtx } from './_generated/server';
import { getAuthUserId } from '@convex-dev/auth/server';

// Helper to get current authenticated user
export async function getCurrentUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);

  if (!userId) {
    throw new ConvexError({ code: 'NotAuthorized', message: 'Unauthorized' });
  }

  const user = await ctx.db.get(userId);

  if (!user) {
    throw new ConvexError({ code: 'NotAuthorized', message: 'User not found' });
  }

  return user;
}

// Get current user ID (for use in queries/mutations)
export const getCurrentUserId = query({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    return userId ?? null;
  },
});

export const getUser = query({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) {
      throw new ConvexError({ code: 'NotAuthorized', message: 'Unauthorized' });
    }

    const user = await ctx.db.get(userId);

    if (!user) {
      throw new ConvexError({ code: 'NotAuthorized', message: 'User not found' });
    }

    return user;
  },
});
