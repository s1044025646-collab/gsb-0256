#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { resolve } from "./uri.js";
import { Store } from "./store.js";
import { resolveOne, startServer } from "./server.js";

const DATA_DIR = process.env.URI_RESOLVER_DATA_DIR ?? path.join(process.cwd(), "data");

function printJson(v: unknown): void {
  process.stdout.write(JSON.stringify(v, null, 2) + "\n");
}

function usage(): void {
  process.stdout.write(
    [
      "用法：",
      "  cli resolve <base> <reference>   解析单条并打印报告",
      "  cli batch <file.json>            批量解析（[{base, reference}, ...]）",
      "  cli history [--limit N]          查看历史",
      "  cli export [file]                导出历史为 JSON",
      "  cli serve [--port N]             启动 HTTP API（默认自动选空闲端口）",
      "  cli demo                         运行 RFC 3986 演示用例",
      "",
    ].join("\n")
  );
}

function demo(): void {
  const base = "http://a/b/c/d;p?q";
  const refs = ["g", "../g", "/g", "//g", "?y", "#s", "", "%2e%2e/g", "../%2E/g"];
  for (const r of refs) {
    const report = resolve(base, r);
    process.stdout.write(
      `base=${base}  ref=${JSON.stringify(r)}  ->  ${report.uri}\n`
    );
  }
}

async function main(): Promise<void> {
  const [, , cmd, ...args] = process.argv;
  const store = new Store(DATA_DIR);

  switch (cmd) {
    case "resolve": {
      const [base, reference] = args;
      if (base === undefined || reference === undefined) {
        usage();
        process.exitCode = 2;
        return;
      }
      const r = resolveOne(store, base, reference);
      printJson(r);
      if (!r.ok) process.exitCode = 1;
      break;
    }
    case "batch": {
      const file = args[0];
      if (!file) {
        usage();
        process.exitCode = 2;
        return;
      }
      const items = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!Array.isArray(items)) {
        process.stderr.write("批量文件必须是 JSON 数组\n");
        process.exitCode = 2;
        return;
      }
      const results = items.map((it: any, i: number) =>
        resolveOne(store, it?.base, it?.reference, i)
      );
      printJson({ ok: results.every((r) => r.ok), results });
      if (!results.every((r) => r.ok)) process.exitCode = 1;
      break;
    }
    case "history": {
      const li = args.indexOf("--limit");
      const limit = li >= 0 ? Number(args[li + 1]) || 50 : 50;
      printJson(store.history(limit, 0));
      break;
    }
    case "export": {
      const rows = store.history(100000, 0).map((r) => ({
        ...r,
        report: JSON.parse(r.report),
      }));
      const out = args[0];
      if (out) {
        fs.writeFileSync(out, JSON.stringify(rows, null, 2), "utf8");
        process.stdout.write(`已导出 ${rows.length} 条到 ${out}\n`);
      } else {
        printJson(rows);
      }
      break;
    }
    case "serve": {
      const pi = args.indexOf("--port");
      const port = pi >= 0 ? Number(args[pi + 1]) || 0 : Number(process.env.PORT) || 0;
      const actual = await startServer(store, port);
      process.stdout.write(`URI 解析服务已启动: http://127.0.0.1:${actual}\n`);
      break;
    }
    case "demo": {
      demo();
      break;
    }
    default:
      usage();
      if (cmd) process.exitCode = 2;
  }

  if (cmd !== "serve") store.close();
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e) + "\n");
  process.exit(1);
});
