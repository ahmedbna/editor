// convex/http.ts

import { httpRouter } from 'convex/server';
import { httpAction, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { ConvexError } from 'convex/values';
import { corsRouter } from 'convex-helpers/server/cors';
import { resendProxy } from './resendProxy';
import { auth } from './auth';
import { createDodoWebhookHandler } from '@dodopayments/convex';

const http = httpRouter();
const httpWithCors = corsRouter(http, {
  allowedHeaders: ['Content-Type', 'X-Chef-Admin-Token', 'Authorization'],
});

auth.addHttpRoutes(http);

function httpActionWithErrorHandling(handler: (ctx: ActionCtx, request: Request) => Promise<Response>) {
  return httpAction(async (ctx, request) => {
    try {
      return await handler(ctx, request);
    } catch (e) {
      console.error(e);
      if (e instanceof ConvexError && e.data?.code === 'NotAuthorized') {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ error: e instanceof ConvexError ? e.message : 'An unknown error occurred' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  });
}

// ─── Existing routes (unchanged) ────────────────────────────────────────────

httpWithCors.route({
  path: '/upload_snapshot',
  method: 'POST',
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const chatId = url.searchParams.get('chatId');
    if (!chatId) throw new ConvexError('chatId is required');

    const blob = await request.blob();
    const storageId = await ctx.storage.store(blob);
    await ctx.runMutation(internal.snapshot.saveSnapshot, {
      userId: userId as Id<'users'>,
      chatId,
      storageId,
    });
    return new Response(JSON.stringify({ snapshotId: storageId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }),
});

http.route({
  pathPrefix: '/resend-proxy/',
  method: 'POST',
  handler: resendProxy,
});

httpWithCors.route({
  path: '/initial_messages',
  method: 'POST',
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const body = await request.json();
    const { userId, chatId, subchatIndex = 0 } = body;
    if (!userId) throw new ConvexError({ code: 'NotAuthorized', message: 'Unauthorized' });
    if (!chatId) throw new ConvexError('chatId is required');

    const storageInfo = await ctx.runQuery(internal.messages.getInitialMessagesStorageInfo, {
      userId,
      chatId,
      subchatIndex,
    });
    if (!storageInfo) return new Response(`Chat not found: ${chatId}`, { status: 404 });
    if (!storageInfo.storageId) return new Response(null, { status: 204 });

    const blob = await ctx.storage.get(storageInfo.storageId);
    return new Response(blob, { status: 200 });
  }),
});

httpWithCors.route({
  path: '/store_chat',
  method: 'POST',
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const chatId = url.searchParams.get('chatId');
    const lastMessageRank = url.searchParams.get('lastMessageRank');
    const lastSubchatIndex = url.searchParams.get('lastSubchatIndex');
    const partIndex = url.searchParams.get('partIndex');
    const formData = await request.formData();
    let firstMessage = url.searchParams.get('firstMessage');
    let messageStorageId: Id<'_storage'> | null = null;
    let snapshotStorageId: Id<'_storage'> | null = null;

    if (formData.has('messages')) {
      messageStorageId = await ctx.storage.store(formData.get('messages') as Blob);
    }
    if (formData.has('snapshot')) {
      snapshotStorageId = await ctx.storage.store(formData.get('snapshot') as Blob);
    }
    if (formData.has('firstMessage')) {
      firstMessage = formData.get('firstMessage') as string;
    }

    await ctx.runMutation(internal.messages.updateStorageState, {
      userId: userId as Id<'users'>,
      chatId: chatId!,
      lastMessageRank: parseInt(lastMessageRank!),
      subchatIndex: parseInt(lastSubchatIndex ?? '0'),
      partIndex: parseInt(partIndex!),
      storageId: messageStorageId,
      snapshotId: snapshotStorageId,
    });

    return new Response(null, { status: 200 });
  }),
});

http.route({
  path: '/__debug/download_messages',
  method: 'OPTIONS',
  handler: httpActionWithErrorHandling(async (_ctx, request) => {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Chef-Admin-Token',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  }),
});

http.route({
  path: '/__debug/download_messages',
  method: 'POST',
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const body = await request.json();
    const header = request.headers.get('X-Chef-Admin-Token');
    const authHeader = request.headers.get('Authorization');
    if (authHeader === null && header !== process.env.CHEF_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ code: 'Unauthorized', message: 'Invalid admin token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const storageId = await ctx.runQuery(internal.messages.getMessagesByChatInitialIdBypassingAccessControl, {
      id: body.chatUuid,
      ensureAdmin: authHeader !== null,
      subchatIndex: 0,
    });
    if (!storageId) return new Response(null, { status: 204 });

    const blob = await ctx.storage.get(storageId);
    return new Response(blob, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
        Vary: 'Origin',
      },
    });
  }),
});

httpWithCors.route({
  path: '/upload_debug_prompt',
  method: 'POST',
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const formData = await request.formData();
    const metadataStr = formData.get('metadata');
    const messagesBlob = formData.get('promptCoreMessages') as Blob;
    if (!metadataStr || !messagesBlob) throw new ConvexError('metadata and messages are required');

    let metadata: any;
    try {
      metadata = JSON.parse(metadataStr as string);
    } catch {
      throw new ConvexError('Invalid metadata: must be valid JSON');
    }

    const promptCoreMessagesStorageId = await ctx.storage.store(messagesBlob);
    try {
      await ctx.runMutation(internal.debugPrompt.storeDebugPrompt, { ...metadata, promptCoreMessagesStorageId });
    } catch (e) {
      await ctx.storage.delete(promptCoreMessagesStorageId);
      throw e;
    }

    return new Response(JSON.stringify({ promptCoreMessagesStorageId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }),
});

httpWithCors.route({
  path: '/upload_thumbnail',
  method: 'POST',
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const url = new URL(request.url);
    const urlId = url.searchParams.get('chatId');
    if (!urlId) return new Response('Missing chatId', { status: 400 });

    const imageBlob = await request.blob();
    if (!imageBlob.type.startsWith('image/')) {
      return new Response(JSON.stringify({ error: 'Invalid file type. Only images are allowed.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (imageBlob.size > 5 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Thumbnail image exceeds maximum size of 5MB' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const storageId = await ctx.storage.store(imageBlob);
    return new Response(JSON.stringify({ storageId }), { headers: { 'Content-Type': 'application/json' } });
  }),
});

httpWithCors.route({
  path: '/api/convex/callback',
  method: 'GET',
  handler: httpActionWithErrorHandling(async (_ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    if (!code) {
      return new Response(JSON.stringify({ error: 'No authorization code provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const CLIENT_ID = process.env.CONVEX_OAUTH_CLIENT_ID;
    const CLIENT_SECRET = process.env.CONVEX_OAUTH_CLIENT_SECRET;
    const REDIRECT_URI = process.env.CONVEX_OAUTH_REDIRECT_URI;
    if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) throw new Error('OAuth configuration missing');

    const tokenResponse = await fetch('https://api.convex.dev/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });
    if (!tokenResponse.ok) {
      return new Response(JSON.stringify({ error: `Failed to exchange code: ${await tokenResponse.text()}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    const [prefix] = accessToken.split('|');
    const teamSlug = prefix.split(':')[1];

    const PROVISION_HOST = process.env.PROVISION_HOST || 'https://api.convex.dev';
    const teamsResponse = await fetch(`${PROVISION_HOST}/api/dashboard/teams`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!teamsResponse.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch teams' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const teams = await teamsResponse.json();
    const team = teams.find((t: any) => t.slug === teamSlug);
    if (!team) {
      return new Response(JSON.stringify({ error: 'Team not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const profileResponse = await fetch(`${PROVISION_HOST}/api/dashboard/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    let convexMemberId = 'unknown';
    if (profileResponse.ok) {
      const profile = await profileResponse.json();
      convexMemberId = profile.id || 'unknown';
    }

    return new Response(JSON.stringify({ token: accessToken, convexMemberId, teamSlug }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }),
});

// Dodo Payments Webhook
http.route({
  path: '/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    try {
      const payload = await request.json();
      console.log('📦 Raw Dodo webhook type:', payload.type, '| event:', JSON.stringify(payload).slice(0, 300));

      if (payload.type === 'payment.succeeded') {
        const data = payload.data;
        const productId: string | undefined = data.product_cart?.[0]?.product_id ?? data.items?.[0]?.product_id;
        const dodoCustomerId: string | undefined = data.customer?.customer_id;
        const convexUserId: string | undefined = data.metadata?.convex_user_id ?? undefined;

        await ctx.runMutation(internal.webhooks.createPayment, {
          paymentId: data.payment_id,
          businessId: payload.business_id,
          customerEmail: data.customer.email,
          amount: data.total_amount,
          currency: data.currency,
          status: data.status,
          webhookPayload: JSON.stringify(payload),
          productId,
          dodoCustomerId,
          convexUserId,
        });
      } else {
        console.log(`ℹ️ Unhandled Dodo webhook type: ${payload.type}`);
      }

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      console.error('Webhook handler error:', e);
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }),
});
export default httpWithCors.http;
