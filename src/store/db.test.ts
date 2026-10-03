import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveReference } from '../uri/resolve.js';
import { ReportStore } from './db.js';

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'uri-db-'));
  return join(dir, 'reports.db');
}

test('成功与失败记录都能保存并按 id 取回原始报告 JSON', () => {
  const path = tempDb();
  const store = new ReportStore(path);
  const report = resolveReference('http://a/b/c/d;p?q', '../g');
  const id = store.saveSuccess('http://a/b/c/d;p?q', '../g', report);
  const errId = store.saveError('http://a/b/c/d;p?q', 'a/%zz', report.algorithmVersion, {
    code: 'INVALID_PERCENT_ENCODING',
    message: 'bad',
    position: 2,
  });

  const row = store.get(id);
  assert.ok(row);
  assert.equal(row?.status, 'ok');
  assert.equal(row?.resolved_uri, 'http://a/b/g');
  const parsed = JSON.parse(row!.report_json);
  assert.equal(parsed.resolvedUri, 'http://a/b/g');

  const errRow = store.get(errId);
  assert.equal(errRow?.status, 'error');
  assert.equal(errRow?.error_code, 'INVALID_PERCENT_ENCODING');
  assert.equal(errRow?.error_position, 2);
  store.close();
});

test('重新打开数据库后仍能读取历史（模拟服务重启）', () => {
  const path = tempDb();
  const first = new ReportStore(path);
  const report = resolveReference('http://a/b', 'c');
  first.saveSuccess('http://a/b', 'c', report);
  first.close();

  assert.ok(existsSync(path));
  const second = new ReportStore(path);
  const rows = second.list(10, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].resolved_uri, 'http://a/c');
  assert.deepEqual(JSON.parse(rows[0].report_json).mergedPath, JSON.parse(rows[0].report_json).mergedPath);
  second.close();
});

test('search 支持关键词过滤', () => {
  const path = tempDb();
  const store = new ReportStore(path);
  store.saveSuccess('http://a/b', 'c', resolveReference('http://a/b', 'c'));
  store.saveSuccess('http://x/y', 'z', resolveReference('http://x/y', 'z'));
  assert.equal(store.search('a/b', 10).length, 1);
  store.close();
});
