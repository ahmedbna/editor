// convex/webhooks.ts
import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { Id } from './_generated/dataModel';

const CREDITS_BY_PRODUCT: Record<string, number> = {
  pdt_0NaHvlJKjLNkfmraxKcDM: 100,
  pdt_0NaHvwJV0gfBgAs7KuHqt: 500,
  pdt_0NaHw3AtFYt1a9agyOYIn: 1000,
};

export const createPayment = internalMutation({
  args: {
    paymentId: v.string(),
    businessId: v.string(),
    customerEmail: v.string(),
    amount: v.number(),
    currency: v.string(),
    status: v.string(),
    webhookPayload: v.string(),
    productId: v.optional(v.string()),
    dodoCustomerId: v.optional(v.string()),
    convexUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Guard: don't process duplicate payments
    const existing = await ctx.db
      .query('payments')
      .withIndex('byPaymentId', (q) => q.eq('paymentId', args.paymentId))
      .first();

    if (existing) {
      console.log(`Payment ${args.paymentId} already processed — skipping`);
      return;
    }

    let userId: string | null = null;

    // ── Primary path: use the Convex userId attached as metadata at checkout ──
    if (args.convexUserId) {
      // convexUserId from identity.subject comes in as "<tableName>|<id>",
      // so we strip the prefix to get the raw Id<'users'>
      const rawId = args.convexUserId.includes('|') ? args.convexUserId.split('|')[1] : args.convexUserId;

      const userById = await ctx.db.get(rawId as Id<'users'>);
      if (userById) {
        userId = userById._id;
        console.log(`Found user by convex_user_id metadata: ${userId}`);
      } else {
        console.warn(
          `convex_user_id "${args.convexUserId}" provided but no matching user found — falling back to email`,
        );
      }
    }

    // ── Fallback: look up by email (authAccounts first, then users.email) ──
    if (!userId) {
      const authAccount = await ctx.db
        .query('authAccounts')
        .filter((q) => q.eq(q.field('providerAccountId'), args.customerEmail))
        .first();

      if (authAccount) {
        userId = authAccount.userId;
        console.log(`Found user via authAccounts for email: ${args.customerEmail}`);
      } else {
        const userByEmail = await ctx.db
          .query('users')
          .withIndex('email', (q) => q.eq('email', args.customerEmail))
          .first();
        if (userByEmail) {
          userId = userByEmail._id;
          console.log(`Found user via users.email for: ${args.customerEmail}`);
        }
      }
    }

    if (!userId) {
      console.error(`No user found for email: ${args.customerEmail} — recording raw payment for reconciliation`);
      await ctx.db.insert('payments', {
        userId: null as any,
        paymentId: args.paymentId,
        businessId: args.businessId,
        customerEmail: args.customerEmail,
        amount: args.amount,
        currency: args.currency,
        status: args.status,
        webhookPayload: args.webhookPayload,
      });
      return;
    }

    const user = await ctx.db.get(userId as Id<'users'>);
    if (!user) {
      console.error(`User doc missing for userId: ${userId}`);
      return;
    }

    const creditsToGrant = args.productId ? (CREDITS_BY_PRODUCT[args.productId] ?? 0) : 0;

    // Record payment
    await ctx.db.insert('payments', {
      userId: user._id,
      paymentId: args.paymentId,
      businessId: args.businessId,
      customerEmail: args.customerEmail,
      amount: args.amount,
      currency: args.currency,
      status: args.status,
      webhookPayload: args.webhookPayload,
    });

    // Save Dodo customer ID on user if not already stored
    if (args.dodoCustomerId && !user.dodoCustomerId) {
      await ctx.db.patch(user._id, { dodoCustomerId: args.dodoCustomerId });
    }

    if (creditsToGrant <= 0) {
      console.warn(
        `No credit mapping found for productId: ${args.productId} — payment recorded but no credits granted`,
      );
      return;
    }

    // Upsert credits
    const creditRecord = await ctx.db
      .query('credits')
      .withIndex('byUserId', (q) => q.eq('userId', user._id))
      .first();

    if (creditRecord) {
      await ctx.db.patch(creditRecord._id, {
        credits: creditRecord.credits + creditsToGrant,
      });
    } else {
      await ctx.db.insert('credits', {
        userId: user._id,
        credits: creditsToGrant,
        totalCreditsUsed: 0,
      });
    }

    console.log(
      `✅ Granted ${creditsToGrant} credits to user ${user._id} (${args.customerEmail}) for payment ${args.paymentId}`,
    );
  },
});

export const createSubscription = internalMutation({
  args: {
    subscriptionId: v.string(),
    businessId: v.string(),
    customerEmail: v.string(),
    status: v.string(),
    webhookPayload: v.string(),
  },
  handler: async (ctx, args) => {
    console.log(`Subscription ${args.subscriptionId} active for ${args.customerEmail}`);
  },
});
