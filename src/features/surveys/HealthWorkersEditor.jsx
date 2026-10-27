import { emptyWorker } from './surveyValidation';
import SurveyDateField from './SurveyDateField';
import AvailabilityChoice from './AvailabilityChoice';

const fields = [
  ['fullName', 'الاسم الرباعي', 'text'],
  ['employeeNumber', 'الرقم الوظيفي', 'text'],
  ['identityNumber', 'رقم الهوية', 'text'],
  ['phoneNumber', 'رقم الجوال', 'tel'],
];

const HealthWorkersEditor = ({ workers = [], onChange, disabled = false }) => {
  const update = (id, field, value, calendar) => onChange(workers.map((worker) => worker.id === id ? { ...worker, [field]: value, ...(calendar ? { [`${field}Calendar`]: calendar } : {}) } : worker));
  const updateAvailability = (id, statusField, dateField, status) => onChange(workers.map((worker) => worker.id === id ? { ...worker, [statusField]: status, ...(status === 'missing' ? { [dateField]: '' } : {}) } : worker));
  return <div className="survey-workers-editor">
    {workers.map((worker, index) => <div className="survey-worker-row" key={worker.id}>
      <div className="survey-section-heading"><strong>العامل {index + 1}</strong><button type="button" className="survey-link-danger" onClick={() => onChange(workers.filter((item) => item.id !== worker.id))} disabled={disabled}>حذف</button></div>
      <div className="survey-worker-fields">{fields.map(([key, label, type]) => <label key={key}>{label}<input className="input-field" type={type} value={worker[key] || ''} onChange={(event) => update(worker.id, key, event.target.value)} disabled={disabled} inputMode={key === 'identityNumber' || key === 'phoneNumber' ? 'numeric' : undefined} /></label>)}<label>هل توجد بصمة للموظف في الفرع؟<select className="input-field" value={worker.hasBranchFingerprint || ''} onChange={(event) => update(worker.id, 'hasBranchFingerprint', event.target.value)} disabled={disabled}><option value="">اختر</option><option value="yes">نعم</option><option value="no">لا</option></select></label><AvailabilityChoice label="الشهادة الصحية" value={worker.healthCertificateStatus || 'available'} onChange={(value) => updateAvailability(worker.id, 'healthCertificateStatus', 'healthCertificateExpiryDate', value)} disabled={disabled} />{worker.healthCertificateStatus === 'missing' ? <p className="survey-missing-note">الشهادة الصحية غير موجودة</p> : <SurveyDateField label="انتهاء الشهادة الصحية" value={worker.healthCertificateExpiryDate || ''} calendarPreference={worker.healthCertificateExpiryDateCalendar || 'gregorian'} onChange={(value, calendar) => update(worker.id, 'healthCertificateExpiryDate', value, calendar)} disabled={disabled} />}<AvailabilityChoice label="شهادة التثقيف" value={worker.educationCertificateStatus || 'available'} onChange={(value) => updateAvailability(worker.id, 'educationCertificateStatus', 'educationExpiryDate', value)} disabled={disabled} />{worker.educationCertificateStatus === 'missing' ? <p className="survey-missing-note">شهادة التثقيف غير موجودة</p> : <SurveyDateField label="انتهاء التثقيف" value={worker.educationExpiryDate || ''} calendarPreference={worker.educationExpiryDateCalendar || 'gregorian'} onChange={(value, calendar) => update(worker.id, 'educationExpiryDate', value, calendar)} disabled={disabled} />}</div>
    </div>)}
    <button type="button" className="btn survey-secondary" onClick={() => onChange([...workers, emptyWorker()])} disabled={disabled}>إضافة عامل</button>
  </div>;
};

export default HealthWorkersEditor;
