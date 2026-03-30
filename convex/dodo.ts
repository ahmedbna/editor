// convex/dodo.ts

import { internal, components } from './_generated/api';
import { internalQuery } from './_generated/server';
import { DodoPayments, DodoPaymentsClientConfig } from '@dodopayments/convex';
import { getAuthUserId } from '@convex-dev/auth/server';

// Internal query to fetch the current user (used by the identify callback)
export const getUser = internalQuery({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});

export const dodo = new DodoPayments(components.dodopayments, {
  // Maps the current Convex user → Dodo Payments customer ID
  identify: async (ctx) => {
    const customer = await ctx.runQuery(internal.dodo.getUser);
    if (!customer) return null;

    // dodoCustomerId is stored on the user record after the first purchase
    // (set by the webhook handler in convex/webhooks.ts)
    return {
      dodoCustomerId: customer.dodoCustomerId ?? null,
    };
  },
  apiKey: process.env.DODO_PAYMENTS_API_KEY!,
  environment: process.env.DODO_PAYMENTS_ENVIRONMENT as 'test_mode' | 'live_mode',
} as DodoPaymentsClientConfig);

// Export the API methods for use across the app
export const { checkout, customerPortal } = dodo.api();
