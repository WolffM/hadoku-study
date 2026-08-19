/**
 * Health check.
 *
 * Public, and reachable both through the edge and directly at *.workers.dev —
 * the monitoring probe uses the direct path with no auth header, which
 * `createEdgeAuth` degrades to `public` rather than refusing.
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { HealthResponseSchema } from '../schemas.js';
import type { AppEnv } from '../types.js';
import { OPTIONAL_AUTH } from '../security.js';

interface RouteContext {
	Bindings: AppEnv;
}

const app = new OpenAPIHono<RouteContext>();

const healthRoute = createRoute({
	method: 'get',
	path: '/health',
	tags: ['Health'],
	summary: 'Health check',
	description: 'Returns the health status of the Study API, including D1 reachability.',
	security: OPTIONAL_AUTH,
	responses: {
		200: {
			description: 'API is healthy',
			content: { 'application/json': { schema: HealthResponseSchema } },
		},
	},
});

app.openapi(healthRoute, async (c) => {
	// Actually touch D1. Reporting `healthy` without it would make this endpoint
	// answer "the worker booted", which is not the question anyone asks it —
	// every route below this one is unusable without the binding.
	let database = false;
	try {
		await c.env.STUDY_DB.prepare('SELECT 1').first();
		database = true;
	} catch (err) {
		console.error('[study-worker] D1 health probe failed:', err);
	}

	return c.json(
		{
			status: database ? ('healthy' as const) : ('unhealthy' as const),
			service: 'study-worker' as const,
			timestamp: new Date().toISOString(),
			database,
		},
		200
	);
});

export const healthRoutes = app;
