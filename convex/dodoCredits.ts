// convex/dodoCredits.ts
//
// Mirrors every credit deduction in Convex to the DodoPayments credit ledger
// so that a customer's Dodo balance stays in sync with their Convex balance.
//
// Flow:
//   1.  deductCreditsForTokensPublic  (credits.ts)  deducts from Convex DB
//   2.  → schedules  syncDodoDebit  (this file)     via ctx.scheduler.runAfter
//   3.  syncDodoDebit calls the DodoPayments REST API to create a debit ledger
//       entry on the customer's credit entitlement balance.
//
// If the user has no dodoCustomerId (free-tier / never purchased), the action
// is a no-op — we simply skip the Dodo side and log a warning.

import { internalAction, internalQuery } from './_generated/server';
import { v } from 'convex/values';

// ─── Constants ───────────────────────────────────────────────────────────────

// The Dodo credit entitlement ID that tracks "generation credits".
// Set DODO_CREDIT_ENTITLEMENT_ID in your Convex environment variables.
function getCreditEntitlementId(): string {
  const id = process.env.DODO_CREDIT_ENTITLEMENT_ID;
  if (!id) {
    throw new Error('DODO_CREDIT_ENTITLEMENT_ID environment variable is not set');
  }
  return id;
}

function getDodoApiKey(): string {
  const key = process.env.DODO_PAYMENTS_API_KEY;
  if (!key) {
    throw new Error('DODO_PAYMENTS_API_KEY environment variable is not set');
  }
  return key;
}

function getDodoBaseUrl(): string {
  const env = process.env.DODO_PAYMENTS_ENVIRONMENT;
  return env === 'live_mode' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com';
}

// ─── Internal query: look up dodoCustomerId for a user ───────────────────────

export const getDodoCustomerId = internalQuery({
  args: { userId: v.id('users') },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    return user?.dodoCustomerId ?? null;
  },
});

// ─── Internal action: debit Dodo credit ledger ───────────────────────────────

export const syncDodoDebit = internalAction({
  args: {
    userId: v.id('users'),
    creditsToDeduct: v.number(),
    chatId: v.optional(v.string()),
    idempotencyKey: v.string(), // prevents duplicate debits on retries
  },
  handler: async (ctx, args) => {
    const { userId, creditsToDeduct, chatId, idempotencyKey } = args;

    if (creditsToDeduct <= 0) {
      console.log('[dodo-credits] Nothing to deduct, skipping');
      return;
    }

    // ── 1. Resolve dodoCustomerId ─────────────────────────────────────────
    const dodoCustomerId: string | null = await ctx.runQuery(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'dodoCredits:getDodoCustomerId' as any,
      { userId },
    );

    if (!dodoCustomerId) {
      // Free-tier user or first-time buyer — no Dodo account yet, skip.
      console.warn(
        `[dodo-credits] No dodoCustomerId for user ${userId} — skipping Dodo debit of ${creditsToDeduct} credits`,
      );
      return;
    }

    // ── 2. Resolve config ─────────────────────────────────────────────────
    let creditEntitlementId: string;
    let apiKey: string;
    let baseUrl: string;
    try {
      creditEntitlementId = getCreditEntitlementId();
      apiKey = getDodoApiKey();
      baseUrl = getDodoBaseUrl();
    } catch (e) {
      console.error('[dodo-credits] Config error:', e);
      return;
    }

    // ── 3. Call DodoPayments Create Ledger Entry (debit) ──────────────────
    const url = `${baseUrl}/credit-entitlements/${creditEntitlementId}/balances/${dodoCustomerId}/ledger-entries`;

    const body = {
      entry_type: 'debit',
      amount: String(creditsToDeduct),
      reason: chatId ? `Generation usage for chat ${chatId}` : 'Generation usage',
      idempotency_key: idempotencyKey,
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (networkErr) {
      console.error('[dodo-credits] Network error calling Dodo API:', networkErr);
      // Non-fatal — Convex balance is already deducted; Dodo will drift but
      // we don't want to break the generation flow.
      return;
    }

    if (response.status === 409) {
      // Idempotency key already exists → debit already applied, safe to ignore.
      console.log(`[dodo-credits] Duplicate debit (idempotency_key=${idempotencyKey}) — already applied, skipping`);
      return;
    }

    if (response.status === 400) {
      const text = await response.text();
      // Insufficient balance is expected for free-tier users whose Dodo
      // balance is zero. Log a warning but don't throw.
      console.warn(`[dodo-credits] 400 Bad Request from Dodo (possibly insufficient balance): ${text}`);
      return;
    }

    if (!response.ok) {
      const text = await response.text();
      console.error(`[dodo-credits] Dodo API error ${response.status}: ${text}`);
      // Non-fatal — log and continue.
      return;
    }

    const result = await response.json();
    console.log(
      `[dodo-credits] Debited ${creditsToDeduct} credits from Dodo customer ${dodoCustomerId} | ` +
        `balance: ${result.balance_before} → ${result.balance_after} | ` +
        `idempotency_key=${idempotencyKey}`,
    );
  },
});
