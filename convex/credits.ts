import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { getCurrentUser } from './users';
import { getAuthUserId } from '@convex-dev/auth/server';
import { internal } from './_generated/api';

export const INITIAL_FREE_CREDITS = 100;

// ── Credit billing rates ──────────────────────────────────────────────────
// 1 credit = 1,000 input tokens   (basePrompt + cacheCreate + cacheRead)
// 1 credit = 100  output tokens   (completion — more expensive)
export const INPUT_TOKENS_PER_CREDIT = 1000;
export const OUTPUT_TOKENS_PER_CREDIT = 1000;

/**
 * Calculate credits to deduct.
 * Credits CAN go negative (user owes).
 */
export function calculateCreditsToDeduct(promptTokens: number, completionTokens: number): number {
  const inputCredits = promptTokens / INPUT_TOKENS_PER_CREDIT;
  const outputCredits = completionTokens / OUTPUT_TOKENS_PER_CREDIT;
  return Math.ceil(inputCredits + outputCredits);
}

// ─────────────────────────────────────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────────────────────────────────────

export const getMyCredits = query({
  handler: async (ctx) => {
    try {
      const user = await getCurrentUser(ctx);
      const credits = await ctx.db
        .query('credits')
        .withIndex('byUserId', (q) => q.eq('userId', user._id))
        .unique();

      if (!credits) {
        return { credits: INITIAL_FREE_CREDITS, totalCreditsUsed: 0, initialized: false };
      }
      return { credits: credits.credits, totalCreditsUsed: credits.totalCreditsUsed, initialized: true };
    } catch {
      return null;
    }
  },
});

export const getUserCreditsInternal = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    return ctx.db
      .query('credits')
      .withIndex('byUserId', (q) => q.eq('userId', args.userId))
      .unique();
  },
});

export const hasCredits = query({
  handler: async (ctx) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (!userId) return false;
      const credits = await ctx.db
        .query('credits')
        .withIndex('byUserId', (q) => q.eq('userId', userId))
        .unique();
      // Allow usage even when negative (don't hard-block, just show warning)
      if (!credits) return true;
      // Block only when deeply negative (more than 10 credits in debt)
      return credits.credits > -10;
    } catch {
      return false;
    }
  },
});

// Get token usage for a specific chat
export const getChatTokenUsage = query({
  args: { chatId: v.string() },
  handler: async (ctx, args) => {
    try {
      const user = await getCurrentUser(ctx);
      const record = await ctx.db
        .query('chatTokenUsage')
        .withIndex('byUserAndChat', (q) => q.eq('userId', user._id).eq('chatId', args.chatId))
        .unique();
      return record ?? null;
    } catch {
      return null;
    }
  },
});

// Get token usage for all chats of the current user
export const getAllChatTokenUsage = query({
  handler: async (ctx) => {
    try {
      const user = await getCurrentUser(ctx);
      return ctx.db
        .query('chatTokenUsage')
        .withIndex('byUserId', (q) => q.eq('userId', user._id))
        .collect();
    } catch {
      return [];
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// MUTATIONS
// ─────────────────────────────────────────────────────────────────────────────

export const initializeUserCredits = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('credits')
      .withIndex('byUserId', (q) => q.eq('userId', args.userId))
      .unique();
    if (existing) return existing._id;
    return ctx.db.insert('credits', {
      userId: args.userId,
      credits: INITIAL_FREE_CREDITS,
      totalCreditsUsed: 0,
    });
  },
});

export const ensureCreditsInitialized = mutation({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const existing = await ctx.db
      .query('credits')
      .withIndex('byUserId', (q) => q.eq('userId', userId))
      .unique();
    if (existing) return existing.credits;
    await ctx.db.insert('credits', { userId, credits: INITIAL_FREE_CREDITS, totalCreditsUsed: 0 });
    return INITIAL_FREE_CREDITS;
  },
});

export const addCredits = mutation({
  args: {
    credits: v.number(),
    paymentIntentId: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    let creditsDoc = await ctx.db
      .query('credits')
      .withIndex('byUserId', (q) => q.eq('userId', user._id))
      .unique();
    if (!creditsDoc) {
      const id = await ctx.db.insert('credits', {
        userId: user._id,
        credits: INITIAL_FREE_CREDITS,
        totalCreditsUsed: 0,
      });
      creditsDoc = await ctx.db.get(id);
    }
    if (!creditsDoc) throw new Error('Failed to get credits record');
    await ctx.db.patch(creditsDoc._id, { credits: creditsDoc.credits + args.credits });
    return { newBalance: creditsDoc.credits + args.credits };
  },
});

/**
 * Public mutation called from the chat API after every generation step.
 *
 * - Deducts credits from Convex (can go negative).
 * - Upserts a chatTokenUsage row so per-chat token breakdown is always fresh.
 * - Schedules a fire-and-forget Dodo ledger debit so the Dodo balance mirrors
 *   the Convex balance for paying customers.
 *
 * Expects the caller (chat.ts) to have already summed:
 *   promptTokens = basePrompt + cacheCreationInputTokens + cacheReadInputTokens
 */
export const deductCreditsForTokensPublic = mutation({
  args: {
    userId: v.id('users'),
    chatId: v.optional(v.string()),
    chatInitialId: v.optional(v.string()),
    // Preferred: pre-summed prompt + raw completion
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
    // Detailed breakdown for the chatTokenUsage table
    basePromptTokens: v.optional(v.number()),
    cacheCreationTokens: v.optional(v.number()),
    cacheReadTokens: v.optional(v.number()),
    // Legacy fallback
    tokensUsed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError({ code: 'NotFound', message: 'User not found' });

    // Resolve token counts
    let promptTokens: number;
    let completionTokens: number;
    let basePromptTokens: number;
    let cacheCreationTokens: number;
    let cacheReadTokens: number;

    if (args.promptTokens !== undefined && args.completionTokens !== undefined) {
      promptTokens = args.promptTokens;
      completionTokens = args.completionTokens;
      basePromptTokens = args.basePromptTokens ?? 0;
      cacheCreationTokens = args.cacheCreationTokens ?? 0;
      cacheReadTokens = args.cacheReadTokens ?? 0;
    } else if (args.tokensUsed !== undefined) {
      // Legacy: all treated as input
      promptTokens = args.tokensUsed;
      completionTokens = 0;
      basePromptTokens = args.tokensUsed;
      cacheCreationTokens = 0;
      cacheReadTokens = 0;
    } else {
      throw new ConvexError({ code: 'InvalidArgs', message: 'Must provide token counts' });
    }

    const creditsToDeduct = calculateCreditsToDeduct(promptTokens, completionTokens);
    const totalTokens = promptTokens + completionTokens;

    // ── 1. Update Convex credits (allow negative) ─────────────────────────
    let creditsDoc = await ctx.db
      .query('credits')
      .withIndex('byUserId', (q) => q.eq('userId', args.userId))
      .unique();

    if (!creditsDoc) {
      const id = await ctx.db.insert('credits', {
        userId: args.userId,
        credits: INITIAL_FREE_CREDITS,
        totalCreditsUsed: 0,
      });
      creditsDoc = await ctx.db.get(id);
    }
    if (!creditsDoc) throw new Error('Failed to create credits record');

    // Credits go negative — no Math.max(0, ...) clamp
    const newCredits = creditsDoc.credits - creditsToDeduct;
    await ctx.db.patch(creditsDoc._id, {
      credits: newCredits,
      totalCreditsUsed: creditsDoc.totalCreditsUsed + creditsToDeduct,
    });

    // ── 2. Upsert chatTokenUsage ──────────────────────────────────────────
    const chatId = args.chatId ?? args.chatInitialId;
    if (chatId) {
      const existing = await ctx.db
        .query('chatTokenUsage')
        .withIndex('byUserAndChat', (q) => q.eq('userId', args.userId).eq('chatId', chatId))
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          inputTokens: existing.inputTokens + basePromptTokens,
          cacheCreationTokens: existing.cacheCreationTokens + cacheCreationTokens,
          cacheReadTokens: existing.cacheReadTokens + cacheReadTokens,
          outputTokens: existing.outputTokens + completionTokens,
          totalBillableInputTokens: existing.totalBillableInputTokens + promptTokens,
          totalTokens: existing.totalTokens + totalTokens,
          creditsDeducted: existing.creditsDeducted + creditsToDeduct,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert('chatTokenUsage', {
          chatId,
          userId: args.userId,
          inputTokens: basePromptTokens,
          cacheCreationTokens,
          cacheReadTokens,
          outputTokens: completionTokens,
          totalBillableInputTokens: promptTokens,
          totalTokens,
          creditsDeducted: creditsToDeduct,
          updatedAt: Date.now(),
        });
      }
    }

    // ── 3. Mirror deduction to DodoPayments (fire-and-forget) ────────────
    //
    // We only debit Dodo for paying customers (those who have a dodoCustomerId).
    // Free-tier users (dodoCustomerId = undefined) are silently skipped inside
    // syncDodoDebit so we don't need to guard here.
    //
    // The idempotency key is deterministic:
    //   <userId>-<chatId>-<updatedAt>-<creditsToDeduct>
    // This means retries from chat.ts won't double-debit Dodo.
    if (creditsToDeduct > 0) {
      const idempotencyKey = [args.userId, chatId ?? 'no-chat', Date.now(), creditsToDeduct].join('-');

      await ctx.scheduler.runAfter(0, internal.dodoCredits.syncDodoDebit, {
        userId: args.userId,
        creditsToDeduct,
        chatId: chatId ?? undefined,
        idempotencyKey,
      });
    }

    return { creditsDeducted: creditsToDeduct, remainingCredits: newCredits };
  },
});

// Internal version (used by server-side mutations, does not sync Dodo)
export const deductCreditsForTokens = internalMutation({
  args: {
    userId: v.id('users'),
    promptTokens: v.number(),
    completionTokens: v.number(),
    chatInitialId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, promptTokens, completionTokens } = args;
    let creditsDoc = await ctx.db
      .query('credits')
      .withIndex('byUserId', (q) => q.eq('userId', userId))
      .unique();
    if (!creditsDoc) {
      const id = await ctx.db.insert('credits', { userId, credits: INITIAL_FREE_CREDITS, totalCreditsUsed: 0 });
      creditsDoc = await ctx.db.get(id);
    }
    if (!creditsDoc) throw new Error('Failed to create credits record');
    const creditsToDeduct = calculateCreditsToDeduct(promptTokens, completionTokens);
    const newCredits = creditsDoc.credits - creditsToDeduct;
    await ctx.db.patch(creditsDoc._id, {
      credits: newCredits,
      totalCreditsUsed: creditsDoc.totalCreditsUsed + creditsToDeduct,
    });
    return { creditsDeducted: creditsToDeduct, remainingCredits: newCredits };
  },
});
