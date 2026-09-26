/**
 * SQLite database initialisation and schema management.
 * 
 * Uses expo-sqlite for local data storage.
 * Schema matches the design in docs/DataIntegrationDesign.md §4.2.
 */

import * as SQLite from 'expo-sqlite';

// ---------------------------------------------------------------------------
// Database instance
// ---------------------------------------------------------------------------

const DB_NAME = 'poc_app.db';

let _db: SQLite.SQLiteDatabase | null = null;

/**
 * Get the database instance (lazy initialised).
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!_db) {
    _db = await SQLite.openDatabaseAsync(DB_NAME);
    await _db.execAsync('PRAGMA journal_mode = WAL;');
    await _db.execAsync('PRAGMA foreign_keys = ON;');
    await initialiseSchema(_db);
  }
  return _db;
}

// ---------------------------------------------------------------------------
// Schema initialisation
// ---------------------------------------------------------------------------

async function initialiseSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    -- Tour context (single active tour cached)
    CREATE TABLE IF NOT EXISTS tour (
      tourId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      startDate TEXT,
      endDate TEXT,
      description TEXT,
      lastSyncedAt TEXT
    );

    -- Riders (cached from API - read only locally)
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

    -- Rides (cached from API)
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

    -- Check-ins (cached from API + locally created)
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

    -- Pending operations queue (unified for online and offline)
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

    -- Dashboard summary cache
    CREATE TABLE IF NOT EXISTS dashboard_summary (
      rideId TEXT PRIMARY KEY,
      totalRiders INTEGER DEFAULT 0,
      checkedIn INTEGER DEFAULT 0,
      notRiding INTEGER DEFAULT 0,
      quitRiding INTEGER DEFAULT 0,
      notCheckedIn INTEGER DEFAULT 0,
      lastSyncedAt TEXT
    );

    -- App configuration cache (shared config bootstrap)
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

    -- Rider personal-code to riderId lookup cache (tour-scoped preload)
    CREATE TABLE IF NOT EXISTS rider_personal_codes (
      personalCode TEXT PRIMARY KEY,
      riderId TEXT NOT NULL,
      tourId TEXT NOT NULL,
      lastSyncedAt TEXT
    );

    -- Event definitions (from events bootstrap)
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

    -- Event occurrences (PLANNED/ACTIVE from today onwards, from bootstrap)
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

    -- Event activity records captured on this device (write-local-first)
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

    -- Hotel room allocations per night
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

    -- Rider baggage custody state (drives offline BAGGAGE_NOT_IN_TOUR block)
    CREATE TABLE IF NOT EXISTS rider_baggage_status (
      riderId TEXT PRIMARY KEY,
      baggageStatus TEXT NOT NULL,
      baggageReleasedAt TEXT,
      lastSyncedAt TEXT
    );

    -- Last fetched occurrence dashboard payload for offline read
    CREATE TABLE IF NOT EXISTS event_dashboard_snapshots (
      occurrenceId TEXT PRIMARY KEY,
      payloadJson TEXT NOT NULL,
      fetchedAt TEXT NOT NULL
    );

    -- Caller's own User-{tourId} record; NULL payload = no tour record
    CREATE TABLE IF NOT EXISTS my_tour_assignment (
      tourId TEXT PRIMARY KEY,
      payloadJson TEXT,
      fetchedAt TEXT NOT NULL
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_check_ins_rider ON check_ins(riderId);
    CREATE INDEX IF NOT EXISTS idx_check_ins_ride ON check_ins(rideId);
    CREATE INDEX IF NOT EXISTS idx_check_ins_sync ON check_ins(syncStatus);
    CREATE INDEX IF NOT EXISTS idx_pending_ops_status ON pending_operations(syncStatus);
    CREATE INDEX IF NOT EXISTS idx_rider_personal_codes_rider ON rider_personal_codes(riderId);
    CREATE INDEX IF NOT EXISTS idx_event_occurrences_event ON event_occurrences(eventId, date);
    CREATE INDEX IF NOT EXISTS idx_event_records_occurrence ON event_activity_records(occurrenceId, timestamp);
    CREATE INDEX IF NOT EXISTS idx_event_records_sync ON event_activity_records(syncStatus);
    CREATE INDEX IF NOT EXISTS idx_room_allocations_hotel ON room_allocations(hotelId, stayDate);
  `);

  const checkInColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(check_ins)');
  const checkInColumnNames = new Set(checkInColumns.map((column) => column.name));

  if (!checkInColumnNames.has('isFloat')) {
    await addColumnIfMissing(db, 'ALTER TABLE check_ins ADD COLUMN isFloat INTEGER DEFAULT 0;');
  }

  if (!checkInColumnNames.has('floatNo')) {
    await addColumnIfMissing(db, 'ALTER TABLE check_ins ADD COLUMN floatNo INTEGER;');
  }

  const riderColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(riders)');
  if (!riderColumns.some((column) => column.name === 'dietaryPreference')) {
    await addColumnIfMissing(db, 'ALTER TABLE riders ADD COLUMN dietaryPreference TEXT;');
  }
}

async function addColumnIfMissing(
  db: SQLite.SQLiteDatabase,
  sql: string,
): Promise<void> {
  try {
    await db.execAsync(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (!message.includes('duplicate column name')) {
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Maintenance utilities
// ---------------------------------------------------------------------------

/**
 * Run VACUUM to reclaim unused space.
 * Should be called during idle time, not at startup.
 */
export async function vacuumDatabase(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync('VACUUM;');
}

/**
 * Purge data for completed/closed rides to save space.
 * Keeps only the current active ride's check-ins.
 */
export async function purgeClosedRideData(
  activeRideId: string,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `DELETE FROM check_ins WHERE rideId != ? AND syncStatus = 'SYNCED'`,
    [activeRideId],
  );
  await db.runAsync(
    `DELETE FROM dashboard_summary WHERE rideId != ?`,
    [activeRideId],
  );
}

/**
 * Reset any operations stuck in SYNCING state (e.g. after app crash).
 * Called at app startup.
 */
export async function resetStuckOperations(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE pending_operations SET syncStatus = 'PENDING' WHERE syncStatus = 'SYNCING'`,
  );
  await db.runAsync(
    `UPDATE check_ins SET syncStatus = 'PENDING' WHERE syncStatus = 'SYNCING'`,
  );
}
