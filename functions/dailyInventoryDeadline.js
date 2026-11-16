const RIYADH_TIMEZONE = 'Asia/Riyadh';

const riyadhDate = (date) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: RIYADH_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const shiftDate = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const lastOverdueDate = (today, graceDays) => shiftDate(today, -graceDays - 1);

module.exports = { riyadhDate, shiftDate, lastOverdueDate, RIYADH_TIMEZONE };
