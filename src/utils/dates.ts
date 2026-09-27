/**
 * Date helpers shared by ride and event screens.
 *
 * Ride and occurrence dates are calendar dates in tour-local time, so "today"
 * must be the device-local date, not the UTC date from toISOString() (DES-03).
 */

/** Device-local calendar date (YYYY-MM-DD). */
export function toLocalDateString(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Today's device-local calendar date (YYYY-MM-DD). */
export function getLocalToday(): string {
  return toLocalDateString(new Date());
}
