import { useState } from 'react';
import { QUESTION_TYPES, createEmptyQuestion } from './surveyConstants';

const labels = {
  [QUESTION_TYPES.DOCUMENT]: 'وثيقة',
  [QUESTION_TYPES.YES_NO]: 'نعم أو لا',
  [QUESTION_TYPES.NOTES]: 'ملاحظات',
  [QUESTION_TYPES.HEALTH_DOCUMENTS]: 'الوثائق الصحية',
};

const emptyForm = () => ({ title: '', description: '', targetBranchIds: [], questions: [createEmptyQuestion()] });

const SurveyEditor = ({ survey, branches, onSave, onCancel, saving }) => {
  const [form, setForm] = useState(() => survey ? {
    title: survey.title || '', description: survey.description || '',
    targetBranchIds: survey.targetBranchIds || [], questions: survey.questions || [],
  } : emptyForm());
  const [error, setError] = useState('');
  const updateQuestion = (id, patch) => setForm((current) => ({ ...current, questions: current.questions.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  const updateBranches = (ids) => setForm((current) => ({ ...current, targetBranchIds: ids }));
  const submit = (event) => {
    event.preventDefault();
    if (!form.title.trim() || !form.targetBranchIds.length || !form.questions.length || form.questions.some((question) => !question.label.trim())) {
      setError('أدخل عنوان الاستبيان وحدد الفروع وأكمل أسماء الحقول.');
      return;
    }
    setError('');
    onSave(form);
  };
  const allSelected = branches.length > 0 && form.targetBranchIds.length === branches.length;

  return <form className="survey-builder card" onSubmit={submit}>
    <div className="survey-section-heading"><div><h2>{survey ? 'تعديل الاستبيان' : 'استبيان مستمر جديد'}</h2><p>{survey ? 'التغييرات تظهر للفروع عند التحميل القادم؛ الإجابات القديمة تحتفظ بنسخة أسئلتها.' : 'سيظهر كل شهر للفروع المختارة حتى إيقافه.'}</p></div><button className="btn survey-secondary" type="button" onClick={onCancel}>إلغاء</button></div>
    <div className="survey-form-grid"><label>اسم الاستبيان<input className="input-field" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>الوصف<input className="input-field" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div>
    <fieldset className="survey-fieldset"><legend>الفروع التي سيظهر لها الاستبيان</legend><div className="survey-fieldset-actions"><span>{form.targetBranchIds.length} من {branches.length} فرع محدد</span><button type="button" className="survey-text-button" onClick={() => updateBranches(allSelected ? [] : branches.map((branch) => branch.id))}>{allSelected ? 'إلغاء اختيار الكل' : 'اختيار الكل'}</button></div><div className="survey-checkbox-grid">{branches.map((branch) => <label key={branch.id}><input type="checkbox" checked={form.targetBranchIds.includes(branch.id)} onChange={() => updateBranches(form.targetBranchIds.includes(branch.id) ? form.targetBranchIds.filter((id) => id !== branch.id) : [...form.targetBranchIds, branch.id])} /> {branch.name || branch.id}</label>)}</div></fieldset>
    <div className="survey-section-heading"><h3>حقول الاستبيان</h3><button type="button" className="btn survey-secondary" onClick={() => setForm((current) => ({ ...current, questions: [...current.questions, createEmptyQuestion()] }))}>إضافة حقل</button></div>
    {form.questions.map((question, index) => <div className="survey-question-editor" key={question.id}>
      <strong>الحقل {index + 1}</strong>
      <select className="input-field" value={question.type} onChange={(event) => updateQuestion(question.id, { type: event.target.value, reasonRequiredWhen: event.target.value === QUESTION_TYPES.YES_NO ? 'no' : null })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <input className="input-field" value={question.label} onChange={(event) => updateQuestion(question.id, { label: event.target.value })} placeholder="اسم الوثيقة أو السؤال" />
      <label className="survey-inline-check"><input type="checkbox" checked={!!question.required} onChange={(event) => updateQuestion(question.id, { required: event.target.checked })} /> مطلوب</label>
      {question.type === QUESTION_TYPES.YES_NO && <label className="survey-inline-check"><input type="checkbox" checked={question.reasonRequiredWhen === 'no'} onChange={(event) => updateQuestion(question.id, { reasonRequiredWhen: event.target.checked ? 'no' : null })} /> سبب عند «لا»</label>}
      {form.questions.length > 1 && <button type="button" className="survey-link-danger" onClick={() => setForm((current) => ({ ...current, questions: current.questions.filter((item) => item.id !== question.id) }))}>حذف</button>}
    </div>)}
    {error && <p className="survey-error">{error}</p>}
    <div className="survey-actions"><button className="btn btn-primary" disabled={saving}>{saving ? 'جاري الحفظ...' : survey ? 'حفظ التعديلات' : 'إنشاء الاستبيان'}</button></div>
  </form>;
};

export default SurveyEditor;
