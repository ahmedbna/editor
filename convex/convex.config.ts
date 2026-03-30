// convex/convex.config.ts

import { defineApp } from 'convex/server';
import dodopayments from '@dodopayments/convex/convex.config';
import rateLimiter from '@convex-dev/rate-limiter/convex.config';

const app = defineApp();
app.use(rateLimiter);
app.use(dodopayments);

export default app;
