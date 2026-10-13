import { emptyWorker } from './surveyValidation';
import SurveyDateField from './SurveyDateField';

const fields = [
  ['fullName', 'الاسم الرباعي', 'text'],
  ['employeeNumber', 'الرقم الوظيفي', 'text'],
  ['identityNumber', 'رقم الهوية', 'text'],
  ['phoneNumber', 'رقم الجوال', 'tel'],
];

const HealthWorkersEditor = ({ workers = [], onChange, disabled = false }) => {
  const update = (id, field, value) => onChange(workers.map((worker) => worker.id === id ? { ...worker, [field]: value } : worker));
  return <div className="survey-workers-editor">
    {workers.map((worker, index) => <div className="survey-worker-row" key={worker.id}>
      <div className="survey-section-heading"><strong>العامل {index + 1}</strong><button type="button" className="survey-link-danger" onClick={() => onChange(workers.filter((item) => item.id !== worker.id))} disabled={disabled}>حذف</button></div>
      <div className="survey-worker-fields">{fields.map(([key, label, type]) => <label key={key}>{label}<input className="input-field" type={type} value={worker[key] || ''} onChange={(event) => update(worker.id, key, event.target.value)} disabled={disabled} inputMode={key === 'identityNumber' || key === 'phoneNumber' ? 'numeric' : undefined} /></label>)}<label>هل توجد بصمة للموظف في الفرع؟<select className="input-field" value={worker.hasBranchFingerprint || ''} onChange={(event) => update(worker.id, 'hasBranchFingerprint', event.target.value)} disabled={disabled}><option value="">اختر</option><option value="yes">نعم</option><option value="no">لا</option></select></label><SurveyDateField label="انتهاء الشهادة الصحية" value={worker.healthCertificateExpiryDate || ''} onChange={(value) => update(worker.id, 'healthCertificateExpiryDate', value)} disabled={disabled} /><SurveyDateField label="انتهاء التثقيف" value={worker.educationExpiryDate || ''} onChange={(value) => update(worker.id, 'educationExpiryDate', value)} disabled={disabled} /></div>
    </div>)}
    <button type="button" className="btn survey-secondary" onClick={() => onChange([...workers, emptyWorker()])} disabled={disabled}>إضافة عامل</button>
  </div>;
};

export default HealthWorkersEditor;
