/**
 * Local SQLite database configuration.
 *
 * Defines the database file name and DDL statements used to initialise the
 * local offline database via expo-sqlite.
 */

export const DB_NAME = 'tourapp.db';

/**
 * DDL statements executed once on first open (and every open, since they use
 * IF NOT EXISTS guards).
 */
export const DB_INIT_STATEMENTS = `
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS riders (
    rider_id     TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    email        TEXT,
    phone        TEXT,
    emergency_contact_name  TEXT,
    emergency_contact_phone TEXT,
    qr_code_data TEXT NOT NULL,
    metadata     TEXT,
    synced_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rides (
    ride_id          TEXT PRIMARY KEY,
    date             TEXT NOT NULL,
    name             TEXT NOT NULL,
    start_location   TEXT NOT NULL,
    finish_location  TEXT NOT NULL,
    total_distance   REAL NOT NULL,
    stages_json      TEXT NOT NULL,
    status           TEXT NOT NULL,
    started_at       TEXT,
    completed_at     TEXT,
    closed_at        TEXT,
    notes            TEXT,
    synced_at        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS check_ins (
    check_in_id   TEXT PRIMARY KEY,
    rider_id      TEXT NOT NULL,
    ride_id       TEXT NOT NULL,
    stage_id      TEXT NOT NULL,
    status        TEXT NOT NULL,
    timestamp     TEXT NOT NULL,
    checked_in_by TEXT NOT NULL,
    method        TEXT NOT NULL,
    notes         TEXT,
    latitude      REAL,
    longitude     REAL,
    synced_at     TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_check_ins_ride_id  ON check_ins (ride_id);
  CREATE INDEX IF NOT EXISTS idx_check_ins_rider_id ON check_ins (rider_id);

  CREATE TABLE IF NOT EXISTS pending_check_ins (
    local_id      TEXT PRIMARY KEY,
    rider_id      TEXT NOT NULL,
    ride_id       TEXT NOT NULL,
    stage_id      TEXT NOT NULL,
    status        TEXT NOT NULL,
    method        TEXT NOT NULL,
    notes         TEXT,
    latitude      REAL,
    longitude     REAL,
    created_at    TEXT NOT NULL,
    sync_status   TEXT NOT NULL DEFAULT 'PENDING',
    retry_count   INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT
  );
`;
