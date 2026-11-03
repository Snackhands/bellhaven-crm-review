import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ReviewService } from './service.js';
import { AppError } from './executor.js';
import { createSchedule, scheduleConfig, tickSchedules, updateSchedule } from './schedules.js';

export function createApp(service: ReviewService, options: { port?: number; webDir?: string; devPort?: number } = {}): express.Express {
  const app = express();
  app.disable('x-powered-by');
  const port = options.port ?? 3001;
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  const origins = new Set([...hosts].map(host => `http://${host}`).concat([`http://localhost:${options.devPort ?? 5173}`, `http://127.0.0.1:${options.devPort ?? 5173}`]));
  app.use((request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (!hosts.has(request.headers.host ?? '')) return next(new AppError('Only the configured localhost host is allowed.', 403));
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) return next(new AppError('This request origin is not allowed.', 403));
    const documentNavigation = request.method === 'GET' && request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document' && !request.path.startsWith('/api/');
    if (request.headers['sec-fetch-site'] === 'cross-site' && !documentNavigation) return next(new AppError('Cross-site requests are not allowed.', 403));
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method) && !request.is('application/json')) return next(new AppError('Mutation requests require application/json.', 415));
    next();
  });
  app.use(express.json({ limit: '32kb', strict: true }));
  app.get('/api/health', (_request, response) => response.json({ ok: true }));
  app.get('/api/state', (_request, response) => response.json(service.state()));
  app.get('/api/runs', (_request, response) => response.json(service.store.runs()));
  app.get('/api/runs/:id', (request, response) => {
    const detail = service.store.runDetail(request.params.id ?? '');
    if (!detail) throw new AppError('Run not found.', 404);
    response.json(detail);
  });
  app.post('/api/local-working-copy/reset', (request, response) => {
    const input = z.object({ expectedSessionId: z.string().min(1) }).strict().parse(request.body);
    response.json(service.resetLocal(input.expectedSessionId));
  });
  app.post('/api/schedules/tick', (request, response) => {
    z.object({}).strict().parse(request.body); tickSchedules(service); response.json({ ok: true });
  });
  app.post('/api/runs', (request, response) => {
    const input = z.object({ source: z.enum(['snapshot', 'live']), workflowId: z.literal('bellhaven').optional() }).strict().parse(request.body);
    response.status(202).json(service.startRun(input.source));
  });
  app.post('/api/proposals/:id/decision', async (request, response) => {
    const input = z.object({ decision: z.enum(['approve', 'reject']), revision: z.string().min(1), runId: z.string().min(1), confirmLive: z.boolean().optional() }).strict().parse(request.body);
    response.json(await service.decide(request.params.id ?? '', input));
  });
  app.post('/api/schedules', (request, response) => response.status(201).json(createSchedule(service.store, request.body)));
  app.patch('/api/schedules/:id', (request, response) => response.json(updateSchedule(service.store, request.params.id ?? '', request.body)));
  app.get('/api/schedules/:id/config', (request, response) => {
    const schedule = service.store.schedule(request.params.id ?? '');
    if (!schedule) throw new AppError('Schedule not found.', 404);
    response.json(scheduleConfig(schedule));
  });
  app.use('/api', (_request, _response, next) => next(new AppError('API route not found.', 404)));
  const webDir = options.webDir ?? resolve('web/dist');
  if (existsSync(resolve(webDir, 'index.html'))) {
    app.use(express.static(webDir, { dotfiles: 'deny', index: false }));
    app.get('/{*path}', (_request, response) => response.sendFile(resolve(webDir, 'index.html')));
  }
  app.use((_request, _response, next) => next(new AppError('Build the web app, then start this server with npm start.', 404)));
  const handleError: express.ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof AppError) response.status(error.status).json({ error: error.message });
    else if (error instanceof z.ZodError) response.status(400).json({ error: error.issues.map(issue => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; ') });
    else if (error instanceof SyntaxError) response.status(400).json({ error: 'The request body is not valid JSON.' });
    else response.status(500).json({ error: 'The local server could not complete this request. Review the current scan state and local configuration.' });
  };
  app.use(handleError);
  return app;
}
