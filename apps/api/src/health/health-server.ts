/**
 * Servidor HTTP mínimo do `/health` (docs/02 §5). Bind em 127.0.0.1 por padrão —
 * é INTERNO, não exposto ao público (o nginx não o encaminha). Sem dependência de
 * framework: `node:http` cru, uma rota. `200` quando saudável, `503` quando
 * degradado (staleness/falha) — assim um `curl` de smoke test já sinaliza.
 *
 * Não agenda nada nem toca no banco além de montar o snapshot sob demanda: cada
 * request recalcula a saúde (barato — poucas queries agregadas + um lstat).
 */

import { createServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { buildHealthSnapshot } from './health.js';
import type { HealthDeps } from './health.js';

const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_NOT_FOUND = 404;

export const DEFAULT_HEALTH_PORT = 8081;
export const DEFAULT_HEALTH_HOST = '127.0.0.1';

export interface HealthServerOptions {
  deps: HealthDeps;
  port?: number;
  host?: string;
}

export interface RunningHealthServer {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

const handle = (deps: HealthDeps) => {
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.url !== '/health') {
      res.writeHead(HTTP_NOT_FOUND, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    buildHealthSnapshot(deps)
      .then((snapshot) => {
        const code = snapshot.status === 'ok' ? HTTP_OK : HTTP_SERVICE_UNAVAILABLE;
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(snapshot, null, 2));
      })
      .catch((err: unknown) => {
        res.writeHead(HTTP_SERVICE_UNAVAILABLE, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      });
  };
};

export const startHealthServer = (opts: HealthServerOptions): Promise<RunningHealthServer> => {
  const host = opts.host ?? DEFAULT_HEALTH_HOST;
  const port = opts.port ?? DEFAULT_HEALTH_PORT;
  const server = createServer(handle(opts.deps));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr !== null ? addr.port : port;
      resolve({
        server,
        port: boundPort,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
};
