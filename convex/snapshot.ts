import { internalMutation, query } from './_generated/server';
import { v } from 'convex/values';
import { getChatByIdOrUrlIdEnsuringAccess, getLatestChatMessageStorageState } from './messages';
import { getCurrentUser } from './users';

// Save the snapshot information after successful upload
export const saveSnapshot = internalMutation({
  args: {
    userId: v.id('users'),
    chatId: v.string(),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, { userId, chatId, storageId }) => {
    const chat = await getChatByIdOrUrlIdEnsuringAccess(ctx, { id: chatId, userId });

    if (!chat) {
      throw new Error('Chat not found');
    }
    await ctx.db.patch(chat._id, {
      snapshotId: storageId,
    });
  },
});

export const getSnapshotUrl = query({
  args: {
    chatId: v.string(),
  },
  handler: async (ctx, { chatId }) => {
    const user = await getCurrentUser(ctx);
    const chat = await getChatByIdOrUrlIdEnsuringAccess(ctx, { id: chatId, userId: user._id });
    if (!chat) {
      throw new Error('Chat not found');
    }
    const chatWithSubchatIndex = { ...chat, subchatIndex: chat.lastSubchatIndex };
    const latestChatStorageState = await getLatestChatMessageStorageState(ctx, chatWithSubchatIndex);
    if (latestChatStorageState?.snapshotId) {
      const url = await ctx.storage.getUrl(latestChatStorageState.snapshotId);
      return url;
    }

    // Maintain backwards compatibility with older chats that don't have snapshots in the chatMessagesStorageState table
    // Some chats might be in the chatMessagesStorageState table but still not have a snapshotId because of a bug in sharing.

    const snapshotId = chat?.snapshotId;
    if (!snapshotId) {
      return null;
    }
    const snapshot = await ctx.storage.getUrl(snapshotId);
    if (!snapshot) {
      throw new Error(`Expected to find a storageUrl for snapshot with id ${snapshotId}`);
    }
    return snapshot;
  },
});
