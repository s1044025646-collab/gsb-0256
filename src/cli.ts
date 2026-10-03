#!/usr/bin/env node
import { writeFileSync, readFileSync } from 'node:fs';
import { resolveReference, ALGORITHM_VERSION } from './uri/resolve.js';
import { serializeError } from './uri/errors.js';
import { defaultDbPath, ReportStore } from './store/db.js';

interface CliOptions {
  dbPath: string;
}

function parseFlags(args: string[]): { positionals: string[]; opts: CliOptions } {
  const positionals: string[] = [];
  let dbPath = process.env.URI_DB_PATH ?? defaultDbPath();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--db') {
      dbPath = args[++i];
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, opts: { dbPath } };
}

function printReport(base: string, reference: string, store: ReportStore, verbose: boolean): number {
  try {
    const report = resolveReference(base, reference);
    const id = store.saveSuccess(base, reference, report);
    if (verbose) {
      console.log(JSON.stringify({ id, ...report }, null, 2));
    } else {
      console.log(report.resolvedUri);
    }
    return 0;
  } catch (err) {
    const error = serializeError(err);
    const id = store.saveError(base, reference, ALGORITHM_VERSION, error);
    console.error(JSON.stringify({ id, error }, null, 2));
    return 2;
  }
}

function usage(): void {
  console.log([
    'uri-resolve — 离线 URI 相对引用解析（RFC 3986 第五节）',
    '',
    '用法：',
    '  uri-resolve resolve "<base>" "<reference>" [--verbose]   解析单条引用（空引用传 ""）',
    '  uri-resolve batch <file.json> [--out result.json]        批量解析',
    '  uri-resolve history [--limit N] [--q 关键词]             查询历史',
    '  uri-resolve get <id>                                     查看单条原始报告',
    '  uri-resolve export [file.json] [--limit N]               导出 JSON（默认打印到 stdout）',
    '',
    '通用选项：',
    '  --db <path>     指定 SQLite 文件（默认 ./data/uri-reports.db）',
    '',
    '批量文件格式：',
    '  { "base": "http://a/b/c/d;p?q", "items": [ {"reference": "g"}, ... ] }',
    '  或 { "items": [ {"base": "...", "reference": "..."}, ... ] }',
    '',
    '退出码：0 成功；2 存在解析错误；1 用法或 IO 错误。',
  ].join('\n'));
}

function main(argv: string[]): number {
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    usage();
    return argv.length === 0 ? 1 : 0;
  }
  const { positionals, opts } = parseFlags(argv);
  const command = positionals[0];
  const store = new ReportStore(opts.dbPath);

  try {
    switch (command) {
      case 'resolve': {
        const base = positionals[1];
        const reference = positionals[2];
        const verbose = positionals.includes('--verbose');
        if (base === undefined || reference === undefined) {
          console.error('错误：resolve 需要 <base> 与 <reference> 两个参数（空引用传 ""）');
          return 1;
        }
        return printReport(base, reference, store, verbose);
      }

      case 'batch': {
        const file = positionals[1];
        if (!file) {
          console.error('错误：batch 需要一个 JSON 文件路径');
          return 1;
        }
        let parsed: { base?: string; items?: Array<{ base?: string; reference?: string }> };
        try {
          parsed = JSON.parse(readFileSync(file, 'utf8'));
        } catch (err) {
          console.error(`无法读取或解析文件：${(err as Error).message}`);
          return 1;
        }
        const items = parsed.items;
        if (!Array.isArray(items)) {
          console.error('错误：批量文件必须包含 items 数组');
          return 1;
        }
        const out = items.map((item, index) => {
          const base = item.base ?? parsed.base;
          const reference = item.reference;
          if (typeof base !== 'string' || typeof reference !== 'string') {
            const error = { code: 'INVALID_INPUT' as const, message: '缺少字符串 base 或 reference' };
            const id = store.saveError(String(base ?? ''), String(reference ?? ''), ALGORITHM_VERSION, error);
            return { index, id, ok: false as const, error };
          }
          try {
            const report = resolveReference(base, reference);
            const id = store.saveSuccess(base, reference, report);
            return { index, id, ok: true as const, resolvedUri: report.resolvedUri, report };
          } catch (err) {
            const error = serializeError(err);
            const id = store.saveError(base, reference, ALGORITHM_VERSION, error);
            return { index, id, ok: false as const, error };
          }
        });
        const failed = out.filter((r) => !r.ok).length;
        const payload = JSON.stringify(
          {
            total: out.length,
            succeeded: out.length - failed,
            failed,
            results: out,
          },
          null,
          2,
        );
        const outIdx = positionals.indexOf('--out');
        if (outIdx !== -1 && positionals[outIdx + 1]) {
          writeFileSync(positionals[outIdx + 1], payload, 'utf8');
          console.log(`已写入 ${positionals[outIdx + 1]}：成功 ${out.length - failed}，失败 ${failed}`);
        } else {
          console.log(payload);
        }
        return failed > 0 ? 2 : 0;
      }

      case 'history': {
        const limitIdx = positionals.indexOf('--limit');
        const qIdx = positionals.indexOf('--q');
        const limit = limitIdx !== -1 ? Number(positionals[limitIdx + 1]) || 50 : 50;
        const rows = qIdx !== -1 ? store.search(positionals[qIdx + 1] ?? '', limit) : store.list(limit, 0);
        console.log(JSON.stringify({ count: rows.length, items: rows }, null, 2));
        return 0;
      }

      case 'get': {
        const id = Number(positionals[1]);
        if (!Number.isInteger(id)) {
          console.error('错误：get 需要一个数字 id');
          return 1;
        }
        const row = store.get(id);
        if (!row) {
          console.error(`未找到 id=${id}`);
          return 1;
        }
        console.log(JSON.stringify({ ...row, report: JSON.parse(row.report_json) }, null, 2));
        return 0;
      }

      case 'export': {
        const limitIdx = positionals.indexOf('--limit');
        const limit = limitIdx !== -1 ? Number(positionals[limitIdx + 1]) || 1000 : 1000;
        const rows = store.list(limit, 0).map((row) => ({
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
        }));
        const payload = JSON.stringify(
          { exportedAt: new Date().toISOString(), algorithmVersion: ALGORITHM_VERSION, count: rows.length, reports: rows },
          null,
          2,
        );
        const file = positionals[1] && !positionals[1].startsWith('--') ? positionals[1] : undefined;
        if (file) {
          writeFileSync(file, payload, 'utf8');
          console.log(`已导出 ${rows.length} 条到 ${file}`);
        } else {
          console.log(payload);
        }
        return 0;
      }

      default:
        console.error(`未知命令：${command}`);
        usage();
        return 1;
    }
  } finally {
    store.close();
  }
}

process.exit(main(process.argv.slice(2)));
