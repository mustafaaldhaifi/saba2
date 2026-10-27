const hijriFormatter = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
  timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
});

const dayMs = 24 * 60 * 60 * 1000;
const pad = (value) => String(value).padStart(2, '0');
const iso = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

export const isValidGregorianDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const gregorianToHijri = (value) => {
  if (!isValidGregorianDate(value)) return '';
  const parts = Object.fromEntries(hijriFormatter.formatToParts(new Date(`${value}T00:00:00Z`)).map(({ type, value: part }) => [type, part]));
  return iso(Number(parts.year), Number(parts.month), Number(parts.day));
};

export const hijriToGregorian = (value) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value || '')) return null;
  let low = Math.floor(Date.UTC(1900, 0, 1) / dayMs);
  let high = Math.floor(Date.UTC(2101, 0, 1) / dayMs);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const date = new Date(middle * dayMs).toISOString().slice(0, 10);
    const hijri = gregorianToHijri(date);
    if (hijri === value) return date;
    if (hijri < value) low = middle + 1;
    else high = middle - 1;
  }
  return null;
};

export const isExpiredDate = (value, today) => isValidGregorianDate(value) && value < today;

export const normalizeExpiryDate = (value) => {
  if (typeof value !== 'string') return null;
  const year = Number(value.slice(0, 4));
  if (year >= 1300 && year <= 1600) return hijriToGregorian(value);
  return isValidGregorianDate(value) ? value : null;
};

export const daysUntilExpiry = (value, today) => {
  const expiry = normalizeExpiryDate(value);
  if (!expiry || !isValidGregorianDate(today)) return null;
  return (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / dayMs;
};

export const formatExpiryDate = (value, calendar) => {
  if (!value) return '—';
  const gregorian = normalizeExpiryDate(value);
  if (!gregorian) return `تاريخ غير صالح: ${value}`;
  const isHijri = calendar === 'hijri' || Number(value.slice(0, 4)) <= 1600;
  return isHijri ? `${value === gregorian ? gregorianToHijri(gregorian) : value} هـ` : `${gregorian} م`;
};
