import * as http from "node:http";
import { AddressInfo } from "node:net";
import { resolve, UriError } from "./uri.js";
import { Store } from "./store.js";

export interface ResolveItemResult {
  index: number;
  ok: boolean;
  id?: number;
  uri?: string;
  report?: unknown;
  error?: { code: string; message: string };
}

export function resolveOne(store: Store, base: unknown, reference: unknown, index = 0): ResolveItemResult {
  if (typeof base !== "string" || typeof reference !== "string") {
    return {
      index,
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "base 与 reference 必须是字符串" },
    };
  }
  try {
    const report = resolve(base, reference);
    const id = store.saveSuccess(base, reference, report);
    return { index, ok: true, id, uri: report.uri, report };
  } catch (e) {
    if (e instanceof UriError) {
      const id = store.saveFailure(base, reference, e.code, e.message);
      return { index, ok: false, id, error: { code: e.code, message: e.message } };
    }
    throw e;
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolveP, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolveP(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;

      if (req.method === "POST" && path === "/api/resolve") {
        let body: any;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return sendJson(res, 400, { ok: false, error: { code: "VALIDATION_ERROR", message: "请求体必须是 JSON" } });
        }
        if (Array.isArray(body?.items)) {
          if (body.items.length === 0 || body.items.length > 1000) {
            return sendJson(res, 400, { ok: false, error: { code: "VALIDATION_ERROR", message: "items 数量须在 1..1000 之间" } });
          }
          const results = body.items.map((it: any, i: number) =>
            resolveOne(store, it?.base, it?.reference, i)
          );
          return sendJson(res, 200, { ok: results.every((r: ResolveItemResult) => r.ok), results });
        }
        const r = resolveOne(store, body?.base, body?.reference, 0);
        return sendJson(res, r.ok ? 200 : 422, r);
      }

      if (req.method === "GET" && path === "/api/history") {
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 500);
        const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
        return sendJson(res, 200, { ok: true, items: store.history(limit, offset) });
      }

      const histMatch = /^\/api\/history\/(\d+)$/.exec(path);
      if (req.method === "GET" && histMatch) {
        const row = store.get(Number(histMatch[1]));
        if (!row) {
          return sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "记录不存在" } });
        }
        return sendJson(res, 200, { ok: true, item: { ...row, report: JSON.parse(row.report) } });
      }

      if (req.method === "GET" && path === "/api/export") {
        const rows = store.history(500, 0);
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": 'attachment; filename="uri-resolutions.json"',
        });
        return res.end(JSON.stringify(rows.map((r) => ({ ...r, report: JSON.parse(r.report) })), null, 2));
      }

      return sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "未知路由" } });
    } catch (e: any) {
      return sendJson(res, 500, { ok: false, error: { code: "INTERNAL", message: String(e?.message ?? e) } });
    }
  });
}

export function startServer(store: Store, port: number): Promise<number> {
  const server = createServer(store);
  return new Promise((resolveP, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolveP(addr.port);
    });
  });
}
