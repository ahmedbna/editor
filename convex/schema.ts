import { defineSchema, defineTable } from 'convex/server';
import { v, Validator } from 'convex/values';
import type { CoreMessage } from 'ai';
import { authTables } from '@convex-dev/auth/server';

export default defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    bio: v.optional(v.string()),
    gender: v.optional(v.string()),
    birthday: v.optional(v.number()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    emailVerificationTime: v.optional(v.float64()),
    phoneVerificationTime: v.optional(v.float64()),
    dodoCustomerId: v.optional(v.string()),
  }).index('email', ['email']),

  convexOAuthConnections: defineTable({
    userId: v.id('users'),
    accessToken: v.string(),
    teamSlug: v.optional(v.string()),
    teamId: v.optional(v.string()),
    teamName: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    refreshToken: v.optional(v.string()),
    convexMemberId: v.string(),
    cachedProfile: v.optional(
      v.object({
        username: v.string(),
        avatar: v.string(),
        email: v.string(),
        id: v.string(),
      }),
    ),
  })
    .index('byUserId', ['userId'])
    .index('byConvexMemberId', ['convexMemberId']),

  convexAdmins: defineTable({
    userId: v.id('users'),
    lastCheckedForAdminStatus: v.number(),
    wasAdmin: v.boolean(),
  }).index('byUserId', ['userId']),

  chats: defineTable({
    userId: v.id('users'),
    initialId: v.string(),
    urlId: v.optional(v.string()),
    description: v.optional(v.string()),
    timestamp: v.string(),
    metadata: v.optional(v.any()),
    snapshotId: v.optional(v.id('_storage')),
    lastMessageRank: v.optional(v.number()),
    lastSubchatIndex: v.number(),
    hasBeenDeployed: v.optional(v.boolean()),
    isDeleted: v.optional(v.boolean()),
    convexProject: v.optional(
      v.union(
        v.object({
          kind: v.literal('connected'),
          projectSlug: v.string(),
          teamSlug: v.string(),
          deploymentUrl: v.string(),
          deploymentName: v.string(),
          warningMessage: v.optional(v.string()),
        }),
        v.object({
          kind: v.literal('connecting'),
          checkConnectionJobId: v.optional(v.id('_scheduled_functions')),
        }),
        v.object({
          kind: v.literal('failed'),
          errorMessage: v.string(),
        }),
      ),
    ),
  })
    .index('byUserAndId', ['userId', 'initialId', 'isDeleted'])
    .index('byUserAndUrlId', ['userId', 'urlId', 'isDeleted'])
    .index('bySnapshotId', ['snapshotId'])
    .index('byInitialId', ['initialId', 'isDeleted']),

  convexProjectCredentials: defineTable({
    projectSlug: v.string(),
    teamSlug: v.string(),
    userId: v.optional(v.id('users')),
    projectDeployKey: v.string(),
  }).index('bySlugs', ['teamSlug', 'projectSlug']),

  chatMessagesStorageState: defineTable({
    chatId: v.id('chats'),
    storageId: v.union(v.id('_storage'), v.null()),
    subchatIndex: v.number(),
    lastMessageRank: v.number(),
    description: v.optional(v.string()),
    partIndex: v.number(),
    snapshotId: v.optional(v.id('_storage')),
  })
    .index('byChatId', ['chatId', 'subchatIndex', 'lastMessageRank', 'partIndex'])
    .index('byStorageId', ['storageId'])
    .index('bySnapshotId', ['snapshotId']),

  resendTokens: defineTable({
    userId: v.id('users'),
    token: v.string(),
    verifiedEmail: v.string(),
    requestsRemaining: v.number(),
    lastUsedTime: v.union(v.number(), v.null()),
  })
    .index('byUserId', ['userId'])
    .index('byToken', ['token']),

  debugChatApiRequestLog: defineTable({
    chatId: v.id('chats'),
    subchatIndex: v.optional(v.number()),
    responseCoreMessages: v.array(v.any() as Validator<CoreMessage, 'required', any>),
    promptCoreMessagesStorageId: v.id('_storage'),
    finishReason: v.string(),
    modelId: v.string(),
    completionTokens: v.optional(v.number()),
    promptTokens: v.optional(v.number()),
    cachedPromptTokens: v.optional(v.number()),
    chefTokens: v.number(),
  })
    .index('byChatId', ['chatId'])
    .index('byStorageId', ['promptCoreMessagesStorageId']),

  credits: defineTable({
    userId: v.id('users'),
    credits: v.number(), // can be negative (user in debt)
    totalCreditsUsed: v.number(),
  }).index('byUserId', ['userId']),

  chatTokenUsage: defineTable({
    chatId: v.string(),
    userId: v.id('users'),
    inputTokens: v.number(), // base uncached prompt tokens
    cacheCreationTokens: v.number(), // tokens written to Anthropic cache
    cacheReadTokens: v.number(), // tokens read from Anthropic cache
    outputTokens: v.number(), // completion tokens
    totalBillableInputTokens: v.number(), // inputTokens + cacheCreationTokens + cacheReadTokens
    totalTokens: v.number(), // totalBillableInputTokens + outputTokens
    creditsDeducted: v.number(), // total credits deducted for this chat
    updatedAt: v.number(), // last update timestamp
  })
    .index('byChatId', ['chatId'])
    .index('byUserId', ['userId'])
    .index('byUserAndChat', ['userId', 'chatId']),

  payments: defineTable({
    userId: v.id('users'),
    paymentId: v.optional(v.string()),
    businessId: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
    status: v.optional(v.string()),
    webhookPayload: v.optional(v.string()),
  })
    .index('byUserId', ['userId'])
    .index('byPaymentId', ['paymentId']),
});
