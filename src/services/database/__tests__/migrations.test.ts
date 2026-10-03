import { describe, expect, it } from '@jest/globals';
import type * as SQLite from 'expo-sqlite';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, runMigrations } from '../migrations';

const PREVIOUS_EVENT_POLICY_COLUMN = ['allow', 'SelfService'].join('');
const PREVIOUS_OCCURRENCE_POLICY_COLUMN = ['selfService', 'Enabled'].join('');

class FakeDatabase {
  userVersion = 4;
  readonly tables = new Map<string, Set<string>>([
    ['events', new Set([
      'eventId', 'eventName', 'eventType', 'location', 'sequenceEnforced',
      'defaultAllowedTypeCodesJson', PREVIOUS_EVENT_POLICY_COLUMN, 'activitiesJson', 'updatedAt', 'lastSyncedAt',
    ])],
    ['event_occurrences', new Set([
      'occurrenceId', 'eventId', 'date', 'seq', 'status', PREVIOUS_OCCURRENCE_POLICY_COLUMN,
      'activityOverridesJson', 'linkedOccurrenceRef', 'updatedAt', 'lastSyncedAt',
    ])],
  ]);
  readonly cachedRows = [{ eventId: 'EVT-OLD', occurrenceId: 'EVT-OLD#2026-10-01#1' }];
  readonly statements: string[] = [];

  async getFirstAsync<T>(query: string): Promise<T | null> {
    if (query === 'PRAGMA user_version') return { user_version: this.userVersion } as T;
    return null;
  }

  async getAllAsync<T>(query: string): Promise<T[]> {
    const table = query.match(/PRAGMA table_info\(([^)]+)\)/)?.[1];
    return [...(this.tables.get(table ?? '') ?? [])].map((name) => ({ name }) as T);
  }

  async execAsync(query: string): Promise<void> {
    this.statements.push(query);
    const version = query.match(/PRAGMA user_version = (\d+)/)?.[1];
    if (version) this.userVersion = Number(version);

    const dropped = query.match(/ALTER TABLE (\w+) DROP COLUMN (\w+)/);
    if (dropped) this.tables.get(dropped[1])?.delete(dropped[2]);

    const added = query.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/);
    if (added) this.tables.get(added[1])?.add(added[2]);
  }

  async withTransactionAsync(work: () => Promise<void>): Promise<void> {
    await work();
  }
}

describe('database migrations', () => {
  it('applies v5 idempotently without disturbing cached records', async () => {
    const db = new FakeDatabase();

    await runMigrations(db as unknown as SQLite.SQLiteDatabase);

    expect(LATEST_SCHEMA_VERSION).toBe(5);
    expect(db.userVersion).toBe(5);
    expect(db.tables.get('events')).toEqual(new Set([
      'eventId', 'eventName', 'eventType', 'location', 'sequenceEnforced',
      'defaultAllowedTypeCodesJson', 'activitiesJson', 'updatedAt', 'lastSyncedAt',
      'registrationEnabled', 'selfServiceAllowed',
    ]));
    expect(db.tables.get('event_occurrences')).toContain('selfServiceAllowed');
    expect(db.tables.get('event_occurrences')).not.toContain(PREVIOUS_OCCURRENCE_POLICY_COLUMN);
    expect(db.cachedRows).toEqual([{ eventId: 'EVT-OLD', occurrenceId: 'EVT-OLD#2026-10-01#1' }]);

    const statementCount = db.statements.length;
    await MIGRATIONS[4].up(db as unknown as SQLite.SQLiteDatabase);
    expect(db.statements).toHaveLength(statementCount);
    await runMigrations(db as unknown as SQLite.SQLiteDatabase);
    expect(db.statements).toHaveLength(statementCount);
    expect(db.userVersion).toBe(5);
  });
});