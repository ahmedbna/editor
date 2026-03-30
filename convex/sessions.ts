import { v } from 'convex/values';
import { action, internalMutation, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { getCurrentUser } from './users';

export const connectConvexOAuth = mutation({
  args: {
    accessToken: v.string(),
    convexMemberId: v.string(),
    teamSlug: v.optional(v.string()),
    teamId: v.optional(v.string()),
    teamName: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    refreshToken: v.optional(v.string()),
    cachedProfile: v.optional(
      v.object({
        username: v.string(),
        avatar: v.string(),
        email: v.string(),
        id: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    // Check if connection already exists
    const existing = await ctx.db
      .query('convexOAuthConnections')
      .withIndex('byUserId', (q) => q.eq('userId', user._id))
      .first();

    // Fetch profile information
    const PROVISION_HOST = process.env.PROVISION_HOST || 'https://api.convex.dev';
    let profile;

    try {
      // This should be done in an action, but for simplicity we'll do it here
      // In production, move this to an action
      const profileResponse = await fetch(`${PROVISION_HOST}/api/dashboard/profile`, {
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
        },
      });

      if (profileResponse.ok) {
        const profileData = await profileResponse.json();
        profile = {
          username: profileData.name || profileData.email,
          email: profileData.email,
          avatar: '', // Convex doesn't provide avatar URLs
          id: profileData.id,
        };
      }
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        cachedProfile: profile,
      });
      return existing._id;
    }

    return ctx.db.insert('convexOAuthConnections', {
      ...args,
      userId: user._id,
      cachedProfile: profile,
    });
  },
});

export const getConvexOAuthConnection = query({
  handler: async (ctx) => {
    try {
      const user = await getCurrentUser(ctx);

      const connection = await ctx.db
        .query('convexOAuthConnections')
        .withIndex('byUserId', (q) => q.eq('userId', user._id))
        .first();

      if (!connection) {
        return null;
      }

      return connection;
    } catch {
      return null;
    }
  },
});

export const disconnectConvexOAuth = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const connection = await ctx.db
      .query('convexOAuthConnections')
      .withIndex('byUserId', (q) => q.eq('userId', user._id))
      .first();

    if (connection) {
      await ctx.db.delete(connection._id);
    }
  },
});

export const updateConvexOAuthProfile = action({
  args: {
    convexAuthToken: v.string(),
  },
  handler: async (ctx, { convexAuthToken }) => {
    const url = `${process.env.PROVISION_HOST || 'https://api.convex.dev'}/api/dashboard/profile`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${convexAuthToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to fetch profile: ${response.statusText}: ${body}`);
    }

    const convexProfile = await response.json();

    const profile = {
      username: convexProfile.name || convexProfile.email,
      email: convexProfile.email,
      avatar: '',
      id: convexProfile.id,
    };

    await ctx.runMutation(internal.sessions.saveCachedConvexProfile, { profile });
  },
});

export const saveCachedConvexProfile = internalMutation({
  args: {
    profile: v.object({
      username: v.string(),
      avatar: v.string(),
      email: v.string(),
      id: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const connection = await ctx.db
      .query('convexOAuthConnections')
      .withIndex('byUserId', (q) => q.eq('userId', user._id))
      .first();

    if (connection) {
      await ctx.db.patch(connection._id, {
        cachedProfile: args.profile,
      });
    }
  },
});
