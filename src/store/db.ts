import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ResolveReport } from '../uri/resolve.js';

export interface HistoryRow {
  id: number;
  created_at: string;
  base_uri: string;
  reference: string;
  resolved_uri: string | null;
  algorithm_version: string;
  status: 'ok' | 'error';
  error_code: string | null;
  error_message: string | null;
  error_position: number | null;
  report_json: string;
}

export class ReportStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    const absolute = resolve(dbPath);
    mkdirSync(dirname(absolute), { recursive: true });
    this.db = new DatabaseSync(absolute);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS resolve_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        base_uri TEXT NOT NULL,
        reference TEXT NOT NULL,
        resolved_uri TEXT,
        algorithm_version TEXT NOT NULL,
        status TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT,
        error_position INTEGER,
        report_json TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_reports_created
      ON resolve_reports(created_at DESC);
    `);
  }

  saveSuccess(baseUri: string, reference: string, report: ResolveReport): number {
    const stmt = this.db.prepare(`
      INSERT INTO resolve_reports
        (base_uri, reference, resolved_uri, algorithm_version, status, report_json)
      VALUES (?, ?, ?, ?, 'ok', ?)
    `);
    const result = stmt.run(
      baseUri,
      reference,
      report.resolvedUri,
      report.algorithmVersion,
      JSON.stringify(report),
    );
    return Number(result.lastInsertRowid);
  }

  saveError(
    baseUri: string,
    reference: string,
    algorithmVersion: string,
    error: { code: string; message: string; position?: number },
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO resolve_reports
        (base_uri, reference, resolved_uri, algorithm_version, status,
         error_code, error_message, error_position, report_json)
      VALUES (?, ?, NULL, ?, 'error', ?, ?, ?, ?)
    `);
    const result = stmt.run(
      baseUri,
      reference,
      algorithmVersion,
      error.code,
      error.message,
      error.position ?? null,
      JSON.stringify({ error, base: baseUri, reference, algorithmVersion }),
    );
    return Number(result.lastInsertRowid);
  }

  list(limit: number, offset: number): HistoryRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM resolve_reports ORDER BY id DESC LIMIT ? OFFSET ?`,
    );
    return stmt.all(limit, offset) as unknown as HistoryRow[];
  }

  get(id: number): HistoryRow | undefined {
    const stmt = this.db.prepare(`SELECT * FROM resolve_reports WHERE id = ?`);
    return stmt.get(id) as unknown as HistoryRow | undefined;
  }

  search(query: string, limit: number): HistoryRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM resolve_reports
       WHERE base_uri LIKE ? OR reference LIKE ? OR resolved_uri LIKE ?
       ORDER BY id DESC LIMIT ?`,
    );
    const like = `%${query}%`;
    return stmt.all(like, like, like, limit) as unknown as HistoryRow[];
  }

  close(): void {
    this.db.close();
  }
}

export function defaultDbPath(): string {
  return resolve(process.cwd(), 'data', 'uri-reports.db');
}
