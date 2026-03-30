import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
} from './_generated/server';
import { ConvexError, v } from 'convex/values';
import { getChatByIdOrUrlIdEnsuringAccess } from './messages';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { getCurrentUser } from './users';

const CONVEX_API_BASE = 'https://api.convex.dev/v1';

export const hasConnectedConvexProject = query({
  args: {
    chatId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const chat = await getChatByIdOrUrlIdEnsuringAccess(ctx, { id: args.chatId, userId: user._id });
    return chat?.convexProject !== undefined;
  },
});

export const loadConnectedConvexProjectCredentials = query({
  args: {
    chatId: v.string(),
  },
  returns: v.union(
    v.object({
      kind: v.literal('connected'),
      projectSlug: v.string(),
      teamSlug: v.string(),
      deploymentUrl: v.string(),
      deploymentName: v.string(),
      adminKey: v.string(),
      warningMessage: v.optional(v.string()),
    }),
    v.object({
      kind: v.literal('connecting'),
    }),
    v.object({
      kind: v.literal('failed'),
      errorMessage: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const chat = await getChatByIdOrUrlIdEnsuringAccess(ctx, { id: args.chatId, userId: user._id });
    if (!chat) {
      return null;
    }
    const project = chat.convexProject;
    if (project === undefined) {
      return null;
    }
    if (project.kind === 'connecting') {
      return { kind: 'connecting' } as const;
    }
    if (project.kind === 'failed') {
      return { kind: 'failed', errorMessage: project.errorMessage } as const;
    }
    const credentials = await ctx.db
      .query('convexProjectCredentials')
      .withIndex('bySlugs', (q) => q.eq('teamSlug', project.teamSlug).eq('projectSlug', project.projectSlug))
      .first();
    if (!credentials) {
      return null;
    }
    return {
      kind: 'connected',
      projectSlug: project.projectSlug,
      teamSlug: project.teamSlug,
      deploymentUrl: project.deploymentUrl,
      deploymentName: project.deploymentName,
      adminKey: credentials.projectDeployKey,
      warningMessage: project.warningMessage,
    } as const;
  },
});

const CHECK_CONNECTION_DEADLINE_MS = 15000;

export const startProvisionConvexProject = mutation({
  args: {
    chatId: v.string(),
    projectInitParams: v.optional(
      v.object({
        teamSlug: v.string(),
        convexAccessToken: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    await startProvisionConvexProjectHelper(ctx, { ...args, userId: user._id });
  },
});

export async function startProvisionConvexProjectHelper(
  ctx: MutationCtx,
  args: {
    userId: Id<'users'>;
    chatId: string;
    projectInitParams?: {
      teamSlug: string;
      convexAccessToken: string;
    };
  },
): Promise<void> {
  const chat = await getChatByIdOrUrlIdEnsuringAccess(ctx, { id: args.chatId, userId: args.userId });
  if (!chat) {
    throw new ConvexError({ code: 'NotAuthorized', message: 'Chat not found' });
  }

  if (args.projectInitParams === undefined) {
    console.error(`Must provide projectInitParams for oauth: ${args.userId}`);
    throw new ConvexError({ code: 'NotAuthorized', message: 'Invalid flow for connecting a project' });
  }

  await ctx.scheduler.runAfter(0, internal.convexProjects.connectConvexProjectForOauth, {
    userId: args.userId,
    chatId: args.chatId,
    accessToken: args.projectInitParams.convexAccessToken,
    teamSlug: args.projectInitParams.teamSlug,
  });
  const jobId = await ctx.scheduler.runAfter(CHECK_CONNECTION_DEADLINE_MS, internal.convexProjects.checkConnection, {
    userId: args.userId,
    chatId: args.chatId,
  });
  await ctx.db.patch(chat._id, { convexProject: { kind: 'connecting', checkConnectionJobId: jobId } });
  return;
}

export const recordProvisionedConvexProjectCredentials = internalMutation({
  args: {
    userId: v.id('users'),
    chatId: v.string(),
    projectSlug: v.string(),
    teamSlug: v.optional(v.string()),
    projectDeployKey: v.string(),
    deploymentUrl: v.string(),
    deploymentName: v.string(),
    warningMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const teamSlug = args.teamSlug ?? 'demo-team';
    await ctx.db.insert('convexProjectCredentials', {
      projectSlug: args.projectSlug,
      teamSlug,
      projectDeployKey: args.projectDeployKey,
    });
    const chat = await getChatByIdOrUrlIdEnsuringAccess(ctx, { id: args.chatId, userId: args.userId });
    if (!chat) {
      console.error(`Chat not found: ${args.chatId}, userId: ${args.userId}`);
      return;
    }
    if (chat.convexProject?.kind === 'connecting') {
      const jobId = chat.convexProject.checkConnectionJobId;
      if (jobId) {
        await ctx.scheduler.cancel(jobId);
      }
    }
    await ctx.db.patch(chat._id, {
      convexProject: {
        kind: 'connected',
        projectSlug: args.projectSlug,
        teamSlug,
        deploymentUrl: args.deploymentUrl,
        deploymentName: args.deploymentName,
        warningMessage: args.warningMessage,
      },
    });
  },
});

const TOTAL_WAIT_TIME_MS = 5000;
const WAIT_TIME_MS = 500;

export const connectConvexProjectForOauth = internalAction({
  args: {
    userId: v.id('users'),
    chatId: v.string(),
    accessToken: v.string(),
    teamSlug: v.string(),
  },
  handler: async (ctx, args) => {
    await _connectConvexProjectForMember(ctx, {
      userId: args.userId,
      chatId: args.chatId,
      accessToken: args.accessToken,
      teamSlug: args.teamSlug,
    })
      .then(async (data) => {
        await ctx.runMutation(internal.convexProjects.recordProvisionedConvexProjectCredentials, {
          userId: args.userId,
          chatId: args.chatId,
          projectSlug: data.projectSlug,
          teamSlug: args.teamSlug,
          projectDeployKey: data.projectDeployKey,
          deploymentUrl: data.deploymentUrl,
          deploymentName: data.deploymentName,
          warningMessage: data.warningMessage,
        });
      })
      .catch(async (error) => {
        console.error(`Error connecting convex project: ${error.message}`);
        const errorMessage = error instanceof ConvexError ? error.data.message : 'Unexpected error';
        await ctx.runMutation(internal.convexProjects.recordFailedConvexProjectConnection, {
          userId: args.userId,
          chatId: args.chatId,
          errorMessage,
        });
      });
  },
});

async function _connectConvexProjectForMember(
  ctx: ActionCtx,
  args: {
    userId: Id<'users'>;
    chatId: string;
    accessToken: string;
    teamSlug: string;
  },
): Promise<{
  projectSlug: string;
  teamSlug: string;
  deploymentUrl: string;
  deploymentName: string;
  projectDeployKey: string;
  warningMessage: string | undefined;
}> {
  let projectName: string | null = null;
  let timeElapsed = 0;

  // Get project name from chat
  while (timeElapsed < TOTAL_WAIT_TIME_MS) {
    projectName = await ctx.runQuery(internal.convexProjects.getProjectName, {
      userId: args.userId,
      chatId: args.chatId,
    });
    if (projectName) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_TIME_MS));
    timeElapsed += WAIT_TIME_MS;
  }
  projectName = projectName ?? 'BNA';

  // Step 1: Get team ID from token details
  const tokenDetailsResponse = await fetch(`${CONVEX_API_BASE}/token_details`, {
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
    },
  });

  if (!tokenDetailsResponse.ok) {
    const text = await tokenDetailsResponse.text();
    throw new ConvexError({
      code: 'ProvisioningError',
      message: `Failed to get token details: ${tokenDetailsResponse.status}`,
      details: text,
    });
  }

  const tokenDetails: { type: 'teamToken'; teamId: number } = await tokenDetailsResponse.json();

  // Step 2: Create project using Management API
  const createProjectResponse = await fetch(`${CONVEX_API_BASE}/teams/${tokenDetails.teamId}/create_project`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({
      projectName,
      deploymentType: 'dev',
    }),
  });

  if (!createProjectResponse.ok) {
    const text = await createProjectResponse.text();
    const defaultProvisioningError = new ConvexError({
      code: 'ProvisioningError',
      message: `Failed to create project: ${createProjectResponse.status}`,
      details: text,
    });

    if (createProjectResponse.status !== 400) {
      throw defaultProvisioningError;
    }

    let data: { code?: string; message?: string } | null = null;
    try {
      data = JSON.parse(text);
    } catch (_e) {
      throw defaultProvisioningError;
    }

    if (data !== null && data.code === 'ProjectQuotaReached' && typeof data.message === 'string') {
      throw new ConvexError({
        code: 'ProvisioningError',
        message: `Failed to create project: ProjectQuotaReached: ${data.message}`,
        details: text,
      });
    }
    throw defaultProvisioningError;
  }

  const createProjectData: {
    projectId: number;
    deploymentName: string;
    deploymentUrl: string;
  } = await createProjectResponse.json();

  // Step 3: List projects to get project slug
  const listProjectsResponse = await fetch(`${CONVEX_API_BASE}/teams/${tokenDetails.teamId}/list_projects`, {
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
    },
  });

  if (!listProjectsResponse.ok) {
    const text = await listProjectsResponse.text();
    throw new ConvexError({
      code: 'ProvisioningError',
      message: `Failed to list projects: ${listProjectsResponse.status}`,
      details: text,
    });
  }

  const projects: Array<{ id: number; slug: string; name: string }> = await listProjectsResponse.json();
  const project = projects.find((p) => p.id === createProjectData.projectId);

  if (!project) {
    throw new ConvexError({
      code: 'ProvisioningError',
      message: 'Created project not found in project list',
    });
  }

  // Step 4: Create deploy key
  const createDeployKeyResponse = await fetch(
    `${CONVEX_API_BASE}/deployments/${createProjectData.deploymentName}/create_deploy_key`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.accessToken}`,
      },
      body: JSON.stringify({
        name: 'BNA Deploy Key',
      }),
    },
  );

  if (!createDeployKeyResponse.ok) {
    const text = await createDeployKeyResponse.text();
    throw new ConvexError({
      code: 'ProvisioningError',
      message: `Failed to create deploy key: ${createDeployKeyResponse.status}`,
      details: text,
    });
  }

  const deployKeyData: { deployKey: string } = await createDeployKeyResponse.json();

  // Calculate remaining projects warning
  const projectsRemaining = 20 - projects.length; // 20 the limit for free tier
  const warningMessage =
    projectsRemaining <= 2 ? `You have ${projectsRemaining} projects remaining on this team.` : undefined;

  return {
    projectSlug: project.slug,
    teamSlug: args.teamSlug,
    deploymentUrl: createProjectData.deploymentUrl,
    deploymentName: createProjectData.deploymentName,
    projectDeployKey: deployKeyData.deployKey,
    warningMessage,
  };
}

export const recordFailedConvexProjectConnection = internalMutation({
  args: {
    userId: v.id('users'),
    chatId: v.string(),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const chat = await getChatByIdOrUrlIdEnsuringAccess(ctx, { id: args.chatId, userId: args.userId });
    if (!chat) {
      console.error(`Chat not found: ${args.chatId}, userId: ${args.userId}`);
      return;
    }
    if (chat.convexProject?.kind === 'connecting') {
      const jobId = chat.convexProject.checkConnectionJobId;
      if (jobId) {
        await ctx.scheduler.cancel(jobId);
      }
    }
    await ctx.db.patch(chat._id, {
      convexProject: { kind: 'failed', errorMessage: args.errorMessage },
    });
  },
});

export const checkConnection = internalMutation({
  args: {
    userId: v.id('users'),
    chatId: v.string(),
  },
  handler: async (ctx, args) => {
    const chat = await getChatByIdOrUrlIdEnsuringAccess(ctx, { id: args.chatId, userId: args.userId });
    if (!chat) {
      console.error(`Chat not found: ${args.chatId}, userId: ${args.userId}`);
      return;
    }
    if (chat.convexProject?.kind !== 'connecting') {
      return;
    }
    await ctx.db.patch(chat._id, { convexProject: { kind: 'failed', errorMessage: 'Failed to connect to project' } });
  },
});

export const getProjectName = internalQuery({
  args: {
    userId: v.id('users'),
    chatId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const chat = await getChatByIdOrUrlIdEnsuringAccess(ctx, { id: args.chatId, userId: args.userId });
    if (!chat) {
      throw new ConvexError({ code: 'NotAuthorized', message: 'Chat not found' });
    }
    return chat.urlId ?? null;
  },
});

export const disconnectConvexProject = mutation({
  args: {
    chatId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const chat = await getChatByIdOrUrlIdEnsuringAccess(ctx, { id: args.chatId, userId: user._id });
    if (!chat) {
      throw new ConvexError({ code: 'NotAuthorized', message: 'Chat not found' });
    }
    await ctx.db.patch(chat._id, { convexProject: undefined });
  },
});

export function ensureEnvVar(name: string) {
  if (!process.env[name]) {
    throw new Error(`Environment variable ${name} is not set`);
  }
  return process.env[name];
}
