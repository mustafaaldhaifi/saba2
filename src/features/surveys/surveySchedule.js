export const SURVEY_FREQUENCY = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTH_START: 'month_start',
  MONTH_END: 'month_end',
};

export const SURVEY_TIMEZONE = 'Asia/Riyadh';

const pad = (value) => String(value).padStart(2, '0');
const dateString = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;
const dateParts = (value) => value.split('-').map(Number);

export const getZonedDateTime = (date = new Date(), timezone = SURVEY_TIMEZONE) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const result = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${result.year}-${result.month}-${result.day}`, time: `${result.hour}:${result.minute}` };
};

export const getSurveySchedule = (survey) => {
  const schedule = survey.schedule ? { ...survey.schedule } : {
    type: SURVEY_FREQUENCY.MONTH_START,
    startDate: `${survey.startsFrom || getZonedDateTime().date.slice(0, 7)}-01`,
    timezone: SURVEY_TIMEZONE,
    missedPolicy: 'latest_only',
  };
  delete schedule.time;
  return schedule;
};

export const getScheduleForOccurrence = (survey, date) => {
  const current = getSurveySchedule(survey);
  if (date >= current.startDate) return current;
  return (survey.scheduleHistory || []).find((entry) => date >= entry.startDate && date < entry.endDate) || current;
};

export const listDueOccurrencesInMonth = (survey, month, now = new Date()) => {
  const schedules = [...(survey.scheduleHistory || []), getSurveySchedule(survey)];
  const [year, monthNumber] = dateParts(month);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const dates = [];
  for (const schedule of schedules) {
    const zonedNow = getZonedDateTime(now, schedule.timezone || SURVEY_TIMEZONE);
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = dateString(year, monthNumber, day);
      if (date < schedule.startDate || (schedule.endDate && date >= schedule.endDate)) continue;
      if (date > zonedNow.date || (date === zonedNow.date && zonedNow.time < (schedule.startTime || '00:00'))) continue;
      const weekday = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay() || 7;
      if (schedule.type === SURVEY_FREQUENCY.DAILY
        || (schedule.type === SURVEY_FREQUENCY.WEEKLY && weekday === Number(schedule.weekDay || 1))
        || (schedule.type === SURVEY_FREQUENCY.MONTH_START && day === 1)
        || (schedule.type === SURVEY_FREQUENCY.MONTH_END && day === daysInMonth)) dates.push(date);
    }
  }
  return [...new Set(dates)].sort();
};

export const getLatestDueOccurrence = (survey, now = new Date()) => {
  const schedule = getSurveySchedule(survey);
  const { date } = getZonedDateTime(now, schedule.timezone || SURVEY_TIMEZONE);
  const [year, month] = dateParts(date);
  for (let offset = 0; offset < 2; offset += 1) {
    const monthDate = new Date(Date.UTC(year, month - offset - 1, 1));
    const monthKey = `${monthDate.getUTCFullYear()}-${pad(monthDate.getUTCMonth() + 1)}`;
    const dates = listDueOccurrencesInMonth(survey, monthKey, now);
    if (dates.length) return dates[dates.length - 1];
  }
  return null;
};

/**
 * Lists unanswered occurrences whose end-of-day deadline has passed.
 * 1. Walk each calendar month from the first schedule start through today.
 * 2. Keep only dates governed by an end-of-day schedule and lacking submission.
 */
export const getExpiredOccurrences = (survey, responses = [], now = new Date()) => {
  // STEP 1: Include past schedule versions so changing a schedule does not erase missed dates.
  const schedules = [...(survey.scheduleHistory || []), getSurveySchedule(survey)];
  const firstStart = schedules.map((schedule) => schedule.startDate).filter(Boolean).sort()[0];
  if (!firstStart) return [];
  const today = getZonedDateTime(now, getSurveySchedule(survey).timezone || SURVEY_TIMEZONE).date;
  const submitted = new Set(responses.filter((response) => response.status === 'submitted').map((response) => {
    if (!response.occurrenceDate && response.month && getScheduleForOccurrence(survey, `${response.month}-01`).type === SURVEY_FREQUENCY.MONTH_END) {
      const [year, month] = dateParts(response.month);
      return dateString(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
    }
    return occurrenceDateOfResponse(response);
  }));
  const dates = [];
  for (let cursor = new Date(`${firstStart.slice(0, 7)}-01T00:00:00Z`); cursor.toISOString().slice(0, 7) <= today.slice(0, 7); cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    const month = cursor.toISOString().slice(0, 7);
    dates.push(...listDueOccurrencesInMonth(survey, month, now).filter((date) =>
      date < today && getScheduleForOccurrence(survey, date).endOfDay && !submitted.has(date)));
  }
  // STEP 2: The oldest missed date is handled first when several are pending.
  return [...new Set(dates)].sort();
};

export const getResponseMonth = (response) => {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(response?.month || '')) return response.month;
  if (/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(response?.occurrenceDate || '')) return response.occurrenceDate.slice(0, 7);
  return response?.id?.match(/__(\d{4}-(?:0[1-9]|1[0-2]))(?:-\d{2})?$/)?.[1] || null;
};

export const occurrenceDateOfResponse = (response) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(response?.occurrenceDate || '')) return response.occurrenceDate;
  const idDate = response?.id?.match(/__(\d{4}-\d{2}-\d{2})$/)?.[1];
  return idDate || (getResponseMonth(response) ? `${getResponseMonth(response)}-01` : null);
};

export const scheduledDateTime = (date, schedule) => {
  const [year, month, day] = dateParts(date);
  const [hour, minute] = (schedule.startTime || '00:00').split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let index = 0; index < 2; index += 1) {
    const zoned = getZonedDateTime(new Date(guess), schedule.timezone || SURVEY_TIMEZONE);
    const [zYear, zMonth, zDay] = dateParts(zoned.date);
    const [zHour, zMinute] = zoned.time.split(':').map(Number);
    const observed = Date.UTC(zYear, zMonth - 1, zDay, zHour, zMinute);
    guess += target - observed;
  }
  return new Date(guess);
};
