import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Store } from "../dist/store.js";
import { resolveOne, createServer } from "../dist/server.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "uri-resolver-"));
}

test("持久化：重启后可读取原始报告", () => {
  const dir = tmpDir();
  const s1 = new Store(dir);
  const r = resolveOne(s1, "http://a/b/c/d;p?q", "../g");
  assert.ok(r.ok && r.id);
  s1.close();

  const s2 = new Store(dir);
  const row = s2.get(r.id!);
  assert.ok(row);
  assert.equal(row!.result_uri, "http://a/b/g");
  const report = JSON.parse(row!.report);
  assert.equal(report.steps.mergedPath, "/b/c/../g");
  assert.equal(report.algorithmVersion, row!.algorithm_version);
  s2.close();
});

test("批量错误逐项定位", () => {
  const dir = tmpDir();
  const s = new Store(dir);
  const results = [
    resolveOne(s, "http://a/b", "g", 0),
    resolveOne(s, "not-absolute", "g", 1),
    resolveOne(s, "http://a/b", "bad%", 2),
  ];
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(results[1].index, 1);
  assert.equal(results[1].error!.code, "BASE_NOT_ABSOLUTE");
  assert.equal(results[2].error!.code, "INVALID_PERCENT_ENCODING");
  s.close();
});

test("HTTP API 单条与历史", async () => {
  const dir = tmpDir();
  const s = new Store(dir);
  const server = createServer(s);
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const port = (server.address() as any).port;

  const resp = await fetch(`http://127.0.0.1:${port}/api/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base: "http://a/b/c/d;p?q", reference: "//g" }),
  });
  assert.equal(resp.status, 200);
  const body: any = await resp.json();
  assert.equal(body.uri, "http://g");

  const bad = await fetch(`http://127.0.0.1:${port}/api/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base: "x", reference: "y" }),
  });
  assert.equal(bad.status, 422);
  const badBody: any = await bad.json();
  assert.equal(badBody.error.code, "BASE_NOT_ABSOLUTE");

  const hist = await fetch(`http://127.0.0.1:${port}/api/history`);
  const histBody: any = await hist.json();
  assert.equal(histBody.items.length, 2);

  await new Promise<void>((res) => server.close(() => res()));
  s.close();
});
