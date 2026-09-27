import { initDb } from '../config/db.js';

async function runMigration() {
  console.log('[Migration] Running database schema migration...');
  try {
    await initDb();
    console.log('[Migration] Schema migration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('[Migration Error]:', err);
    process.exit(1);
  }
}

runMigration();
