import { useState } from 'react';
import { gregorianToHijri, hijriToGregorian } from './surveyDates';

const SurveyDateField = ({ label, value = '', calendarPreference = 'gregorian', onChange, disabled = false }) => {
  const [calendar, setCalendar] = useState(calendarPreference);
  const [hijriDraft, setHijriDraft] = useState(null);
  const hijriValue = gregorianToHijri(value);
  const displayedHijri = hijriDraft ?? hijriValue;
  const invalidHijri = displayedHijri && !hijriToGregorian(displayedHijri);

  const chooseCalendar = (next) => {
    setCalendar(next);
    setHijriDraft(null);
    if (next !== calendar) onChange(value, next);
  };
  const updateHijri = (next) => {
    const normalized = next.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
    setHijriDraft(normalized);
    onChange(normalized ? hijriToGregorian(normalized) || '' : '', 'hijri');
  };

  return <div className="survey-date-field">
    <span className="survey-date-label">{label}</span>
    <div className="survey-calendar-toggle" aria-label={`تقويم ${label}`}>
      <button type="button" className={calendar === 'gregorian' ? 'selected' : ''} onClick={() => chooseCalendar('gregorian')} disabled={disabled}>ميلادي</button>
      <button type="button" className={calendar === 'hijri' ? 'selected' : ''} onClick={() => chooseCalendar('hijri')} disabled={disabled}>هجري</button>
    </div>
    {calendar === 'gregorian'
      ? <input className="input-field" type="date" aria-label={`${label} ميلادي`} value={value} onChange={(event) => onChange(event.target.value, 'gregorian')} disabled={disabled} />
      : <input className="input-field" type="text" inputMode="numeric" placeholder="1448-04-01" aria-label={`${label} هجري`} value={displayedHijri} onChange={(event) => updateHijri(event.target.value)} disabled={disabled} />}
    {calendar === 'hijri' && <small className={invalidHijri ? 'survey-date-invalid' : ''}>{invalidHijri ? 'أدخل تاريخًا هجريًا صحيحًا بصيغة YYYY-MM-DD' : value ? `الموافق ميلادي: ${value}` : 'الصيغة: YYYY-MM-DD'}</small>}
  </div>;
};

export default SurveyDateField;
