import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { ALGORITHM_VERSION, ResolveReport } from "./uri.js";

export interface HistoryRow {
  id: number;
  base: string;
  reference: string;
  ok: number;
  result_uri: string | null;
  error_code: string | null;
  error_message: string | null;
  algorithm_version: string;
  report: string;
  created_at: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "uri-resolver.db"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS resolutions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        base TEXT NOT NULL,
        reference TEXT NOT NULL,
        ok INTEGER NOT NULL,
        result_uri TEXT,
        error_code TEXT,
        error_message TEXT,
        algorithm_version TEXT NOT NULL,
        report TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);
  }

  saveSuccess(base: string, reference: string, report: ResolveReport): number {
    const stmt = this.db.prepare(
      `INSERT INTO resolutions (base, reference, ok, result_uri, algorithm_version, report)
       VALUES (?, ?, 1, ?, ?, ?)`
    );
    const r = stmt.run(base, reference, report.uri, ALGORITHM_VERSION, JSON.stringify(report));
    return Number(r.lastInsertRowid);
  }

  saveFailure(base: string, reference: string, code: string, message: string): number {
    const stmt = this.db.prepare(
      `INSERT INTO resolutions (base, reference, ok, error_code, error_message, algorithm_version, report)
       VALUES (?, ?, 0, ?, ?, ?, ?)`
    );
    const report = { algorithmVersion: ALGORITHM_VERSION, error: { code, message } };
    const r = stmt.run(base, reference, code, message, ALGORITHM_VERSION, JSON.stringify(report));
    return Number(r.lastInsertRowid);
  }

  history(limit: number, offset: number): HistoryRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM resolutions ORDER BY id DESC LIMIT ? OFFSET ?`
    );
    return stmt.all(limit, offset) as unknown as HistoryRow[];
  }

  get(id: number): HistoryRow | undefined {
    const stmt = this.db.prepare(`SELECT * FROM resolutions WHERE id = ?`);
    return stmt.get(id) as unknown as HistoryRow | undefined;
  }

  close(): void {
    this.db.close();
  }
}
