/**
 * Date utility functions for consistent WIB (Asia/Jakarta, UTC+7) timezone handling
 */

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function toWibShiftedDate(baseDate = new Date()) {
  const d = baseDate instanceof Date ? baseDate : new Date(baseDate);
  if (isNaN(d.getTime())) {
    throw new TypeError('Invalid date provided to date utility');
  }
  return new Date(d.getTime() + WIB_OFFSET_MS);
}

function getTodayISODate(baseDate = new Date()) {
  const wib = toWibShiftedDate(baseDate);
  const year = wib.getUTCFullYear();
  const month = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const day = String(wib.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentISOTime(baseDate = new Date()) {
  const wib = toWibShiftedDate(baseDate);
  const hours = String(wib.getUTCHours()).padStart(2, '0');
  const minutes = String(wib.getUTCMinutes()).padStart(2, '0');
  const seconds = String(wib.getUTCSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function addHours(date, hours) {
  const result = new Date(date);
  result.setHours(result.getHours() + hours);
  return result;
}

module.exports = {
  WIB_OFFSET_MS,
  getTodayISODate,
  getCurrentISOTime,
  addHours
};

