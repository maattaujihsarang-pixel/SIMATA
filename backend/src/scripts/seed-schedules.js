/**
 * Standalone idempotent CLI script to seed MA At-Taujih 2026/2027 Semester Ganjil schedule
 * Usage: node backend/src/scripts/seed-schedules.js [--overwrite]
 */
const db = require('../config/database');
const { seedDefaultSchedule2026Ganjil } = require('../services/schedule-seed.service');

async function main() {
  const overwrite = process.argv.includes('--overwrite');
  const result = await db.withTransaction(async (client) => {
    return await seedDefaultSchedule2026Ganjil(client, {
      academicYearId: '2026/2027',
      semester: 'GANJIL',
      overwrite
    });
  });

  console.log('[SIMATA SCHEDULE SEED RESULT]', JSON.stringify(result, null, 2));
  await db.closePool();
}

main().catch(async (err) => {
  console.error('[SIMATA SCHEDULE SEED FAILED]', err);
  try { await db.closePool(); } catch (_) {}
  process.exit(1);
});
