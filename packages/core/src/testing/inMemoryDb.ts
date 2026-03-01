import { type SqliteDatabase, ensureDatabaseSchema, openDatabase } from "../db/bootstrap";

export function createInMemoryDatabase(): SqliteDatabase {
  const db = openDatabase(":memory:");
  ensureDatabaseSchema(db);
  return db;
}

export function withInMemoryDatabase<T>(callback: (db: SqliteDatabase) => T): T {
  const db = createInMemoryDatabase();
  try {
    return callback(db);
  } finally {
    db.close();
  }
}
