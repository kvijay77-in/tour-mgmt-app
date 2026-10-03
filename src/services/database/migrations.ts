/**
 * SQLite schema migrations (DES-04).
 *
 * The schema version is tracked in `PRAGMA user_version`. Migrations run in
 * ascending order at database open; each one runs in its own transaction and
 * bumps `user_version` on success, so an interrupted upgrade resumes from the
 * last completed step. Every migration must be idempotent because installs
 * created before versioning start at user_version 0 with tables that already
 * exist.
 *
 * Add new schema changes as a new entry at the end of MIGRATIONS — never edit
 * a migration that has shipped.
 *
 * See docs/DataIntegrationDesign.md §4.2.
 */

import type * as SQLite from 'expo-sqlite';
import { logger } from '../../utils/logger';

const TAG = 'DbMigrations';

export interface Migration {
  version: number;
  description: string;
  up: (db: SQLite.SQLiteDatabase) => Promise<void>;
}

/**
 * Add a column when it does not exist yet (ALTER TABLE has no IF NOT EXISTS).
 */
async function addColumnIfMissing(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.some((existing) => existing.name === column)) return;
  await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}

async function dropColumnIfExists(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!columns.some((existing) => existing.name === column)) return;
  await db.execAsync(`ALTER TABLE ${table} DROP COLUMN ${column};`);
}

const BASE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS tour (
    tourId TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    startDate TEXT,
    endDate TEXT,
    description TEXT,
    lastSyncedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS riders (
    riderId TEXT PRIMARY KEY,
    profileId TEXT,
    name TEXT,
    email TEXT,
    phone TEXT,
    emergencyContactName TEXT,
    emergencyContactPhone TEXT,
    photoS3Key TEXT,
    qrCodeData TEXT,
    status TEXT,
    lastSyncedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS rides (
    rideId TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    rideNo INTEGER,
    name TEXT,
    startLocation TEXT,
    finishLocation TEXT,
    totalDistance REAL,
    flagOffTime TEXT,
    status TEXT,
    stagesJson TEXT,
    description TEXT,
    startedAt TEXT,
    completedAt TEXT,
    closedAt TEXT,
    lastSyncedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS check_ins (
    checkInId TEXT PRIMARY KEY,
    riderId TEXT NOT NULL,
    rideId TEXT NOT NULL,
    stageNumber INTEGER NOT NULL,
    stageId TEXT,
    timestamp TEXT NOT NULL,
    checkedInBy TEXT,
    method TEXT,
    isNotRiding INTEGER DEFAULT 0,
    isQuitRiding INTEGER DEFAULT 0,
    isManualEntry INTEGER DEFAULT 0,
    notes TEXT,
    locationLat REAL,
    locationLng REAL,
    isLocal INTEGER DEFAULT 0,
    syncStatus TEXT DEFAULT 'SYNCED',
    syncError TEXT,
    syncRetryCount INTEGER DEFAULT 0,
    createdAt TEXT,
    lastSyncedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS pending_operations (
    localId TEXT PRIMARY KEY,
    operationType TEXT NOT NULL,
    payload TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    syncStatus TEXT DEFAULT 'PENDING',
    syncError TEXT,
    retryCount INTEGER DEFAULT 0,
    lastAttemptAt TEXT
  );

  CREATE TABLE IF NOT EXISTS dashboard_summary (
    rideId TEXT PRIMARY KEY,
    totalRiders INTEGER DEFAULT 0,
    checkedIn INTEGER DEFAULT 0,
    notRiding INTEGER DEFAULT 0,
    quitRiding INTEGER DEFAULT 0,
    notCheckedIn INTEGER DEFAULT 0,
    lastSyncedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS app_config (
    configType TEXT NOT NULL,
    configId TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    configJson TEXT NOT NULL,
    version INTEGER,
    updatedAt TEXT,
    lastSyncedAt TEXT,
    PRIMARY KEY (configType, configId)
  );

  CREATE TABLE IF NOT EXISTS rider_personal_codes (
    personalCode TEXT PRIMARY KEY,
    riderId TEXT NOT NULL,
    tourId TEXT NOT NULL,
    lastSyncedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    eventId TEXT PRIMARY KEY,
    eventName TEXT NOT NULL,
    eventType TEXT NOT NULL,
    location TEXT,
    sequenceEnforced INTEGER NOT NULL DEFAULT 0,
    defaultAllowedTypeCodesJson TEXT NOT NULL DEFAULT '[]',
    allowSelfService INTEGER NOT NULL DEFAULT 0,
    activitiesJson TEXT NOT NULL DEFAULT '[]',
    updatedAt TEXT,
    lastSyncedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS event_occurrences (
    occurrenceId TEXT PRIMARY KEY,
    eventId TEXT NOT NULL,
    date TEXT NOT NULL,
    seq INTEGER NOT NULL,
    status TEXT NOT NULL,
    selfServiceEnabled INTEGER NOT NULL DEFAULT 0,
    activityOverridesJson TEXT NOT NULL DEFAULT '[]',
    linkedOccurrenceRef TEXT,
    updatedAt TEXT,
    lastSyncedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS event_activity_records (
    localId TEXT PRIMARY KEY,
    recordId TEXT,
    occurrenceId TEXT NOT NULL,
    eventId TEXT NOT NULL,
    activityId TEXT NOT NULL,
    activityName TEXT NOT NULL,
    riderId TEXT NOT NULL,
    typeCode TEXT,
    bagLabel TEXT,
    outcome TEXT NOT NULL,
    variantSelected TEXT,
    method TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    isFlagged INTEGER NOT NULL DEFAULT 0,
    isCancelled INTEGER NOT NULL DEFAULT 0,
    isLocal INTEGER NOT NULL DEFAULT 1,
    syncStatus TEXT NOT NULL DEFAULT 'PENDING',
    syncError TEXT,
    retryCount INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    lastSyncedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS room_allocations (
    stayDate TEXT NOT NULL,
    riderId TEXT NOT NULL,
    hotelId TEXT NOT NULL,
    roomNo TEXT,
    roomCapacity INTEGER NOT NULL DEFAULT 2,
    sharingWithJson TEXT NOT NULL DEFAULT '[]',
    source TEXT,
    updatedAt TEXT,
    lastSyncedAt TEXT,
    PRIMARY KEY (stayDate, riderId)
  );

  CREATE TABLE IF NOT EXISTS rider_baggage_status (
    riderId TEXT PRIMARY KEY,
    baggageStatus TEXT NOT NULL,
    baggageReleasedAt TEXT,
    lastSyncedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS event_dashboard_snapshots (
    occurrenceId TEXT PRIMARY KEY,
    payloadJson TEXT NOT NULL,
    fetchedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS my_tour_assignment (
    tourId TEXT PRIMARY KEY,
    payloadJson TEXT,
    fetchedAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_check_ins_rider ON check_ins(riderId);
  CREATE INDEX IF NOT EXISTS idx_check_ins_ride ON check_ins(rideId);
  CREATE INDEX IF NOT EXISTS idx_check_ins_sync ON check_ins(syncStatus);
  CREATE INDEX IF NOT EXISTS idx_pending_ops_status ON pending_operations(syncStatus);
  CREATE INDEX IF NOT EXISTS idx_rider_personal_codes_rider ON rider_personal_codes(riderId);
  CREATE INDEX IF NOT EXISTS idx_event_occurrences_event ON event_occurrences(eventId, date);
  CREATE INDEX IF NOT EXISTS idx_event_records_occurrence ON event_activity_records(occurrenceId, timestamp);
  CREATE INDEX IF NOT EXISTS idx_event_records_sync ON event_activity_records(syncStatus);
  CREATE INDEX IF NOT EXISTS idx_room_allocations_hotel ON room_allocations(hotelId, stayDate);
`;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Base schema (pre-versioning tables and ad-hoc columns)',
    up: async (db) => {
      await db.execAsync(BASE_SCHEMA_SQL);
      await addColumnIfMissing(db, 'check_ins', 'isFloat', 'INTEGER DEFAULT 0');
      await addColumnIfMissing(db, 'check_ins', 'floatNo', 'INTEGER');
      await addColumnIfMissing(db, 'riders', 'dietaryPreference', 'TEXT');
    },
  },
  {
    version: 2,
    description: 'Offline mode: queue backoff/owner, readiness caches, sync metadata',
    up: async (db) => {
      // Outbound queue: per-operation backoff and the signed-in user who captured it.
      await addColumnIfMissing(db, 'pending_operations', 'nextAttemptAt', 'TEXT');
      await addColumnIfMissing(db, 'pending_operations', 'ownerUserId', 'TEXT');

      // Check-ins: tour scope, cancellation fields and the capturing user.
      await addColumnIfMissing(db, 'check_ins', 'tourId', 'TEXT');
      await addColumnIfMissing(db, 'check_ins', 'ownerUserId', 'TEXT');
      await addColumnIfMissing(db, 'check_ins', 'cancelledAt', 'TEXT');
      await addColumnIfMissing(db, 'check_ins', 'cancelledBy', 'TEXT');
      await addColumnIfMissing(db, 'check_ins', 'status', 'TEXT');
      await addColumnIfMissing(db, 'check_ins', 'prevStatus', 'TEXT');

      // Readiness caches keep the full API payload so no field is lost offline.
      await addColumnIfMissing(db, 'riders', 'tourId', 'TEXT');
      await addColumnIfMissing(db, 'rides', 'tourId', 'TEXT');
      await addColumnIfMissing(db, 'rides', 'payloadJson', 'TEXT');
      await addColumnIfMissing(db, 'tour', 'payloadJson', 'TEXT');

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS sync_meta (
          dataset TEXT PRIMARY KEY,
          lastSyncedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS rider_names (
          tourId TEXT NOT NULL,
          riderId TEXT NOT NULL,
          name TEXT,
          PRIMARY KEY (tourId, riderId)
        );

        CREATE TABLE IF NOT EXISTS app_user_names (
          sub TEXT PRIMARY KEY,
          name TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_pending_ops_due ON pending_operations(syncStatus, nextAttemptAt);
        CREATE INDEX IF NOT EXISTS idx_check_ins_ride_sync ON check_ins(rideId, syncStatus);
      `);
    },
  },
  {
    version: 3,
    description: 'Offline mode: log of check-ins sent from the device queue (server cross-check)',
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS sent_check_ins (
          localId TEXT PRIMARY KEY,
          tourId TEXT NOT NULL,
          rideId TEXT NOT NULL,
          riderId TEXT NOT NULL,
          requestJson TEXT NOT NULL,
          serverCheckInId TEXT,
          ownerUserId TEXT,
          sentAt TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sent_check_ins_ride ON sent_check_ins(tourId, rideId);
      `);
    },
  },
  {
    version: 4,
    description: 'Notifications inbox cache for offline read (mobile only)',
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS notifications_inbox (
          notificationId TEXT PRIMARY KEY,
          ruleId TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          priority TEXT NOT NULL,
          targetJson TEXT,
          tourId TEXT,
          createdAt TEXT NOT NULL,
          isRead INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications_inbox(createdAt DESC);
        CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications_inbox(isRead, createdAt DESC);
      `);
    },
  },
  {
    version: 5,
    description: 'Event self-service and registration policy fields',
    up: async (db) => {
      await dropColumnIfExists(db, 'events', 'allowSelfService');
      await dropColumnIfExists(db, 'event_occurrences', 'selfServiceEnabled');
      await addColumnIfMissing(db, 'events', 'registrationEnabled', 'INTEGER NOT NULL DEFAULT 0');
      await addColumnIfMissing(db, 'events', 'selfServiceAllowed', 'INTEGER NOT NULL DEFAULT 0');
      await addColumnIfMissing(db, 'event_occurrences', 'selfServiceAllowed', 'INTEGER');
    },
  },
];

/** Latest schema version this build knows about. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/**
 * Bring the database up to LATEST_SCHEMA_VERSION.
 * A failed migration rolls back and is rethrown (the app cannot run on a
 * half-migrated schema).
 */
export async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = row?.user_version ?? 0;

  if (currentVersion > LATEST_SCHEMA_VERSION) {
    logger.warn(TAG, `Database schema v${currentVersion} is newer than this build (v${LATEST_SCHEMA_VERSION})`);
    return;
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;
    logger.info(TAG, `Applying migration v${migration.version}: ${migration.description}`);
    await db.withTransactionAsync(async () => {
      await migration.up(db);
      // PRAGMA does not accept bound parameters; version is a trusted constant.
      await db.execAsync(`PRAGMA user_version = ${Math.trunc(migration.version)}`);
    });
  }
}
