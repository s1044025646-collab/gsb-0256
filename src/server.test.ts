import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from 'node:http';
import { createApp } from './server.js';
import { ReportStore } from './store/db.js';

function startServer(): { store: ReportStore; server: Server } {
  const db = join(mkdtempSync(join(tmpdir(), 'uri-api-')), 'r.db');
  const store = new ReportStore(db);
  const server = createApp(store);
  return { store, server };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  return `http://127.0.0.1:${addr.port}`;
}

async function post(base: string, path: string, body: unknown) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

test('单条解析返回报告', async () => {
  const { server, store } = startServer();
  const url = await listen(server);
  try {
    const { status, json } = await post(url, '/api/resolve', {
      base: 'http://a/b/c/d;p?q',
      reference: '../g',
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.report.resolvedUri, 'http://a/b/g');
    assert.equal(typeof json.id, 'number');
  } finally {
    server.close();
    (store as unknown as ReportStore).close();
  }
});

test('不合格基准返回 422 与错误码', async () => {
  const { server, store } = startServer();
  const url = await listen(server);
  try {
    const { status, json } = await post(url, '/api/resolve', { base: 'rel', reference: 'g' });
    assert.equal(status, 422);
    assert.equal(json.ok, false);
    assert.equal(json.error.code, 'BASE_NOT_ABSOLUTE');
  } finally {
    server.close();
    (store as unknown as ReportStore).close();
  }
});

test('批量解析逐项定位错误，不整体失败', async () => {
  const { server, store } = startServer();
  const url = await listen(server);
  try {
    const { status, json } = await post(url, '/api/batch', {
      base: 'http://a/b/c/d;p?q',
      items: [{ reference: 'g' }, { reference: 'a/%zz' }, { reference: '/x' }],
    });
    assert.equal(status, 200);
    assert.equal(json.total, 3);
    assert.equal(json.succeeded, 2);
    assert.equal(json.failed, 1);
    assert.equal(json.results[0].ok, true);
    assert.equal(json.results[0].report.resolvedUri, 'http://a/b/c/g');
    assert.equal(json.results[1].ok, false);
    assert.equal(json.results[1].index, 1);
    assert.equal(json.results[1].error.code, 'INVALID_PERCENT_ENCODING');
    assert.equal(json.results[2].report.resolvedUri, 'http://a/x');
  } finally {
    server.close();
    (store as unknown as ReportStore).close();
  }
});

test('历史与单条报告接口', async () => {
  const { server, store } = startServer();
  const url = await listen(server);
  try {
    const created = await post(url, '/api/resolve', { base: 'http://a/b', reference: 'c' });
    const id = created.json.id;
    const hist = await fetch(url + '/api/history').then((r) => r.json());
    assert.ok(hist.count >= 1);
    const one = await fetch(url + `/api/reports/${id}`).then((r) => r.json());
    assert.equal(one.report.resolvedUri, 'http://a/c');
    const exported = await fetch(url + '/api/export').then((r) => r.json());
    assert.ok(exported.count >= 1);
    assert.equal(exported.reports[0].report.resolvedUri, 'http://a/c');
  } finally {
    server.close();
    (store as unknown as ReportStore).close();
  }
});
