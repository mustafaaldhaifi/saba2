import { emptyWorker } from './surveyValidation';

const fields = [
  ['fullName', 'الاسم الرباعي', 'text'],
  ['identityNumber', 'رقم الهوية', 'text'],
  ['phoneNumber', 'رقم الجوال', 'tel'],
  ['healthCertificateExpiryDate', 'انتهاء الشهادة الصحية', 'date'],
  ['educationExpiryDate', 'انتهاء التثقيف', 'date'],
];

const HealthWorkersEditor = ({ workers = [], onChange, disabled = false }) => {
  const update = (id, field, value) => onChange(workers.map((worker) => worker.id === id ? { ...worker, [field]: value } : worker));
  return <div className="survey-workers-editor">
    {workers.map((worker, index) => <div className="survey-worker-row" key={worker.id}>
      <div className="survey-section-heading"><strong>العامل {index + 1}</strong><button type="button" className="survey-link-danger" onClick={() => onChange(workers.filter((item) => item.id !== worker.id))} disabled={disabled}>حذف</button></div>
      <div className="survey-worker-fields">{fields.map(([key, label, type]) => <label key={key}>{label}<input className="input-field" type={type} value={worker[key] || ''} onChange={(event) => update(worker.id, key, event.target.value)} disabled={disabled} inputMode={key === 'identityNumber' || key === 'phoneNumber' ? 'numeric' : undefined} /></label>)}</div>
    </div>)}
    <button type="button" className="btn survey-secondary" onClick={() => onChange([...workers, emptyWorker()])} disabled={disabled}>إضافة عامل</button>
  </div>;
};

export default HealthWorkersEditor;
