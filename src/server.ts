import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { resolveReference, ALGORITHM_VERSION } from './uri/resolve.js';
import { serializeError, UriError } from './uri/errors.js';
import { defaultDbPath, ReportStore } from './store/db.js';

interface ResolveBody {
  base?: unknown;
  reference?: unknown;
}

interface BatchBody {
  base?: unknown;
  items?: unknown;
  references?: unknown;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_048_576) {
        reject(new UriError('INVALID_INPUT', '请求体超过 1 MiB 限制'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function parseJsonBody(req: IncomingMessage): Promise<any> {
  const raw = await readBody(req);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new UriError('INVALID_INPUT', '请求体不是合法 JSON');
  }
}

function runOne(store: ReportStore, base: string, reference: string) {
  try {
    const report = resolveReference(base, reference);
    const id = store.saveSuccess(base, reference, report);
    return { ok: true as const, id, report };
  } catch (err) {
    const error = serializeError(err);
    const id = store.saveError(base, reference, ALGORITHM_VERSION, error);
    return { ok: false as const, id, error };
  }
}

export function createApp(store: ReportStore): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;

    try {
      if (route === 'GET /health') {
        sendJson(res, 200, { status: 'ok', algorithmVersion: ALGORITHM_VERSION });
        return;
      }

      if (route === 'POST /api/resolve') {
        const body = (await parseJsonBody(req)) as ResolveBody;
        const result = runOne(
          store,
          typeof body.base === 'string' ? body.base : '',
          typeof body.reference === 'string' ? body.reference : '',
        );
        sendJson(res, result.ok ? 200 : 422, result);
        return;
      }

      if (route === 'POST /api/batch') {
        const body = (await parseJsonBody(req)) as BatchBody;
        const sharedBase = body.base;
        const rawItems: unknown[] = Array.isArray(body.items)
          ? body.items
          : Array.isArray(body.references)
            ? (body.references as unknown[]).map((reference) => ({ base: sharedBase, reference }))
            : [];

        if (!Array.isArray(rawItems) || rawItems.length === 0) {
          throw new UriError('INVALID_INPUT', '参数 "items" 必须是非空数组，元素为 {"base","reference"}');
        }
        if (rawItems.length > 1000) {
          throw new UriError('INVALID_INPUT', '单批最多 1000 条');
        }

        const results = rawItems.map((raw, index) => {
          const item = (raw ?? {}) as { base?: unknown; reference?: unknown };
          const base = typeof item.base === 'string' ? item.base : (typeof sharedBase === 'string' ? sharedBase : '');
          const reference = typeof item.reference === 'string' ? item.reference : '';
          if (base === '' || typeof item.reference !== 'string') {
            const error = {
              code: 'INVALID_INPUT' as const,
              message: '每条记录必须包含字符串 "base" 与 "reference"',
            };
            const id = store.saveError(String(base), String(item.reference ?? ''), ALGORITHM_VERSION, error);
            return { index, ok: false as const, id, error };
          }
          const out = runOne(store, base, reference);
          return { index, ...out };
        });

        const failures = results.filter((r) => !r.ok).length;
        sendJson(res, 200, {
          total: results.length,
          succeeded: results.length - failures,
          failed: failures,
          results,
        });
        return;
      }

      if (route === 'GET /api/history') {
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 500);
        const offset = Number(url.searchParams.get('offset') ?? 0) || 0;
        const q = url.searchParams.get('q');
        const rows = q ? store.search(q, limit) : store.list(limit, offset);
        sendJson(res, 200, { count: rows.length, items: rows });
        return;
      }

      if (route.startsWith('GET /api/reports/')) {
        const id = Number(url.pathname.split('/').pop());
        if (!Number.isInteger(id) || id <= 0) {
          throw new UriError('INVALID_INPUT', '报告 id 必须是正整数');
        }
        const row = store.get(id);
        if (!row) {
          sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `未找到 id=${id} 的报告` } });
          return;
        }
        sendJson(res, 200, { ...row, report: JSON.parse(row.report_json) });
        return;
      }

      if (route === 'GET /api/export') {
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 1000) || 1000, 10_000);
        const rows = store.list(limit, 0);
        sendJson(res, 200, {
          exportedAt: new Date().toISOString(),
          algorithmVersion: ALGORITHM_VERSION,
          count: rows.length,
          reports: rows.map((row) => ({
            id: row.id,
            createdAt: row.created_at,
            base: row.base_uri,
            reference: row.reference,
            status: row.status,
            resolvedUri: row.resolved_uri,
            error:
              row.status === 'error'
                ? { code: row.error_code, message: row.error_message, position: row.error_position }
                : null,
            report: JSON.parse(row.report_json),
          })),
        });
        return;
      }

      sendJson(res, 404, {
        error: { code: 'NOT_FOUND', message: `未知路由：${route}` },
      });
    } catch (err) {
      sendJson(res, 400, { error: serializeError(err) });
    }
  });
}

/** 让操作系统选择一个空闲端口（默认行为）；PORT 环境变量可固定端口。 */
function listenFree(server: Server, preferredPort?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const port = preferredPort ?? 0;
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else reject(new Error('无法获取监听端口'));
    });
  });
}

async function main(): Promise<void> {
  const dbPath = process.env.URI_DB_PATH ?? defaultDbPath();
  const store = new ReportStore(dbPath);
  const server = createApp(store);
  const preferred = process.env.PORT ? Number(process.env.PORT) : undefined;
  const port = await listenFree(server, preferred);
  const host = '127.0.0.1';
  console.log(JSON.stringify({
    message: 'URI 相对引用解析服务已启动（离线，不发起任何网络请求）',
    url: `http://${host}:${port}`,
    health: `http://${host}:${port}/health`,
    db: dbPath,
    algorithmVersion: ALGORITHM_VERSION,
  }, null, 2));
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
if (invokedPath.endsWith('server.ts') || invokedPath.endsWith('server.js')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
