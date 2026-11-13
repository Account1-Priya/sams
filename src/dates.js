/** Date helpers shared by the routes that build chart series. */

/** A pg DATE comes back as a JS Date; normalise everything to "YYYY-MM-DD". */
export const asDate = (v) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);

/** "2025-11-10" -> "10 Nov", for compact axis ticks. */
export const shortDate = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`;
};

/** "2025-11-10" -> "10 Nov 2025", for tooltips and the table view. */
export const longDate = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
};

/** Today as "YYYY-MM-DD" in local time (what a date input expects). */
export const today = () => {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
};
