import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DashboardLayout from '../../layouts/DashboardLayout';
import { RESPONSE_STATUS, SURVEY_STATUS, formatMonth, getCurrentMonth, getRecentMonths } from './surveyConstants';
import { createSurvey, deleteSurveyMonth, deleteSurveyPermanently, getBranches, getResponsesForSurvey, getSurveys, updateSurvey, updateSurveyStatus } from './surveyService';
import SurveyEditor from './SurveyEditor';
import SurveyResponseDetailsModal from './SurveyResponseDetailsModal';
import SurveyPdfDocument from './SurveyPdfDocument';
import './survey.css';

const statusLabel = { active: 'نشط', paused: 'موقوف', archived: 'مؤرشف' };

const SurveysDashboard = () => {
  const [surveys, setSurveys] = useState([]);
  const [branches, setBranches] = useState([]);
  const [responses, setResponses] = useState([]);
  const [selectedSurveyId, setSelectedSurveyId] = useState('');
  const [editorSurvey, setEditorSurvey] = useState(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [responsesLoading, setResponsesLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedResponse, setSelectedResponse] = useState(null);
  const [exportMonth, setExportMonth] = useState(getCurrentMonth());
  const [exportBranchIds, setExportBranchIds] = useState([]);
  const [exporting, setExporting] = useState(false);
  const pdfRef = useRef(null);

  const selectedSurvey = surveys.find((survey) => survey.id === selectedSurveyId) || null;
  const months = useMemo(() => [...new Set([...getRecentMonths(), ...responses.map((response) => response.month)])].sort().reverse(), [responses]);
  const visibleBranches = useMemo(() => selectedSurvey ? branches.filter((branch) =>
    selectedSurvey.targetBranchIds?.includes(branch.id) || responses.some((response) => response.branchId === branch.id)) : [], [branches, responses, selectedSurvey]);

  const loadSurveys = useCallback(async () => {
    try {
      setIsLoading(true);
      const [surveyList, branchList] = await Promise.all([getSurveys(), getBranches()]);
      setSurveys(surveyList);
      setBranches(branchList);
      setSelectedSurveyId((current) => surveyList.some((survey) => survey.id === current) ? current : surveyList[0]?.id || '');
    } catch (error) { setMessage('تعذر تحميل الاستبيانات والفروع.'); console.error(error); }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { loadSurveys(); }, [loadSurveys]);
  useEffect(() => {
    if (!selectedSurveyId) { setResponses([]); return undefined; }
    let live = true;
    setResponsesLoading(true);
    getResponsesForSurvey(selectedSurveyId)
      .then((items) => { if (live) setResponses(items); })
      .catch((error) => { if (live) setMessage('تعذر تحميل إجابات الاستبيان.'); console.error(error); })
      .finally(() => { if (live) setResponsesLoading(false); });
    return () => { live = false; };
  }, [selectedSurveyId]);
  useEffect(() => { setExportBranchIds(selectedSurvey?.targetBranchIds || []); }, [selectedSurveyId, selectedSurvey?.targetBranchIds]);

  const saveSurvey = async (form) => {
    try {
      setIsSaving(true);
      if (editorSurvey) await updateSurvey(editorSurvey, form);
      else await createSurvey(form);
      setEditorSurvey(undefined);
      setMessage(editorSurvey ? 'تم تعديل الاستبيان.' : 'تم إنشاء الاستبيان.');
      await loadSurveys();
    } catch (error) { setMessage('تعذر حفظ الاستبيان.'); console.error(error); }
    finally { setIsSaving(false); }
  };

  const changeStatus = async (survey, status) => {
    try {
      await updateSurveyStatus(survey.id, status);
      setSurveys((current) => current.map((item) => item.id === survey.id ? { ...item, status } : item));
      setMessage(status === SURVEY_STATUS.ARCHIVED ? 'تمت الأرشفة، وبقيت الإجابات محفوظة.' : 'تم تغيير حالة الاستبيان.');
    } catch (error) { setMessage('تعذر تغيير الحالة.'); console.error(error); }
  };

  const removeSurvey = async (survey) => {
    const linkedResponses = await getResponsesForSurvey(survey.id);
    const monthsCount = new Set(linkedResponses.map((response) => response.month)).size;
    if (!window.confirm(`حذف نهائي لاستبيان «${survey.title}» و${linkedResponses.length} إجابة من ${monthsCount} شهر؟ لا يمكن التراجع.`)) return;
    try {
      const count = await deleteSurveyPermanently(survey.id);
      setMessage(`تم حذف الاستبيان و${count} إجابة وسجلات تصحيحها.`);
      setResponses([]);
      await loadSurveys();
    } catch (error) { setMessage('تعذر إكمال الحذف. تحقق من صلاحيات Firestore وأعد المحاولة.'); console.error(error); }
  };

  const removeMonth = async () => {
    if (!selectedSurvey || exportMonth === getCurrentMonth()) return;
    const count = responses.filter((response) => response.month === exportMonth).length;
    if (!count) return;
    if (!window.confirm(`حذف ${count} إجابة لاستبيان «${selectedSurvey.title}» في ${formatMonth(exportMonth)} نهائياً؟`)) return;
    try {
      await deleteSurveyMonth(selectedSurvey.id, exportMonth);
      setResponses((current) => current.filter((response) => response.month !== exportMonth));
      setMessage(`تم حذف إجابات ${formatMonth(exportMonth)} وسجلات تصحيحها.`);
    } catch (error) { setMessage('تعذر حذف إجابات الشهر.'); console.error(error); }
  };

  const exportPdf = async () => {
    if (!selectedSurvey || exportBranchIds.length === 0 || !pdfRef.current) return;
    try {
      setExporting(true);
      const { default: html2pdf } = await import('html2pdf.js');
      const filename = `استبيان_${selectedSurvey.title}_${exportMonth}.pdf`.replace(/[\\/:*?"<>|]/g, '_');
      await html2pdf().set({
        margin: [8, 8, 8, 8], filename,
        image: { type: 'jpeg', quality: 0.97 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 760 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css'] },
      }).from(pdfRef.current).save();
      setMessage(`تم تصدير ${exportBranchIds.length} فرع في ملف PDF واحد.`);
    } catch (error) { setMessage('تعذر إنشاء ملف PDF.'); console.error(error); }
    finally { setExporting(false); }
  };

  const exportBranches = branches.filter((branch) => exportBranchIds.includes(branch.id));
  const getResponse = (branchId, month) => responses.find((response) => response.branchId === branchId && response.month === month);

  return <DashboardLayout title="إدارة الاستبيانات" role="admin">
    <div className="survey-admin-header"><div><h1>الاستبيانات الشهرية</h1><p>إنشاء الاستبيانات ومتابعة إجابات الفروع وتصديرها.</p></div><button type="button" className="btn btn-primary" onClick={() => setEditorSurvey(null)}>إضافة استبيان</button></div>
    {message && <div className="survey-message" role="status">{message}</div>}
    {editorSurvey !== undefined && <SurveyEditor key={editorSurvey?.id || 'new'} survey={editorSurvey} branches={branches} onSave={saveSurvey} onCancel={() => setEditorSurvey(undefined)} saving={isSaving} />}

    <section className="survey-list-section"><h2>الاستبيانات</h2>{isLoading ? <p>جاري التحميل...</p> : surveys.length === 0 ? <div className="card">لا توجد استبيانات بعد.</div> : <div className="survey-admin-list">{surveys.map((survey) => <article className="survey-admin-item card" key={survey.id}>
      <div><h3>{survey.title}</h3><p>{survey.description || 'بدون وصف'}</p><small>{survey.targetBranchIds?.length || 0} فرع · يبدأ من {formatMonth(survey.startsFrom)}</small></div>
      <div className="survey-admin-actions"><span className={`survey-response-state ${survey.status}`}>{statusLabel[survey.status]}</span><button type="button" className="btn survey-secondary" onClick={() => setEditorSurvey(survey)}>تعديل</button>{survey.status === SURVEY_STATUS.ACTIVE ? <button type="button" className="btn survey-secondary" onClick={() => changeStatus(survey, SURVEY_STATUS.PAUSED)}>إيقاف</button> : <button type="button" className="btn survey-secondary" onClick={() => changeStatus(survey, SURVEY_STATUS.ACTIVE)}>تشغيل</button>}{survey.status !== SURVEY_STATUS.ARCHIVED && <button type="button" className="btn survey-secondary" onClick={() => changeStatus(survey, SURVEY_STATUS.ARCHIVED)}>أرشفة</button>}{survey.status === SURVEY_STATUS.ARCHIVED && <button type="button" className="btn survey-danger" onClick={() => removeSurvey(survey)}>حذف نهائي</button>}</div>
    </article>)}</div>}</section>

    <section className="survey-monitor card"><div className="survey-section-heading"><div><h2>متابعة الفروع حسب الشهر</h2><p>اضغط «تم» أو «مسودة» لعرض التفاصيل وتصحيحها.</p></div>{surveys.length > 0 && <select className="input-field survey-select" value={selectedSurveyId} onChange={(event) => { setSelectedSurveyId(event.target.value); setSelectedResponse(null); }}><option value="" disabled>اختر الاستبيان</option>{surveys.map((survey) => <option key={survey.id} value={survey.id}>{survey.title}</option>)}</select>}</div>
      {responsesLoading && <p>جاري تحميل الإجابات...</p>}
      {selectedSurvey && <div className="survey-table-wrap"><table className="survey-monitor-table"><thead><tr><th>الفرع</th>{months.map((month) => <th key={month}>{formatMonth(month)}</th>)}</tr></thead><tbody>{visibleBranches.map((branch) => <tr key={branch.id}><td>{branch.name || branch.id}</td>{months.map((month) => { const response = getResponse(branch.id, month); const state = response?.status || (month < selectedSurvey.startsFrom ? 'not-applicable' : 'pending'); const label = response?.status === RESPONSE_STATUS.SUBMITTED ? 'تم' : response?.status === RESPONSE_STATUS.DRAFT ? 'مسودة' : state === 'not-applicable' ? '—' : 'لم يرسل'; return <td key={month}>{response ? <button type="button" className={`survey-response-state survey-state-button ${state}`} onClick={() => setSelectedResponse({ response, branch })}>{label}</button> : <span className={`survey-response-state ${state}`}>{label}</span>}</td>; })}</tr>)}</tbody></table></div>}
    </section>

    {selectedSurvey && <section className="survey-monitor card"><h2>تصدير وتنظيف بيانات الاستبيان</h2><p className="survey-helper">اختر الشهر والفروع. سيتم جمع جميع الفروع المختارة في ملف PDF واحد.</p><div className="survey-form-grid"><label>الشهر<select className="input-field" value={exportMonth} onChange={(event) => setExportMonth(event.target.value)}>{months.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}</select></label><label>الفروع المحددة: {exportBranchIds.length}<button type="button" className="btn survey-secondary" onClick={() => setExportBranchIds(exportBranchIds.length === visibleBranches.length ? [] : visibleBranches.map((branch) => branch.id))}>{exportBranchIds.length === visibleBranches.length ? 'إلغاء اختيار الكل' : 'اختيار الكل'}</button></label></div><div className="survey-checkbox-grid">{visibleBranches.map((branch) => <label key={branch.id}><input type="checkbox" checked={exportBranchIds.includes(branch.id)} onChange={() => setExportBranchIds((current) => current.includes(branch.id) ? current.filter((id) => id !== branch.id) : [...current, branch.id])} /> {branch.name || branch.id}</label>)}</div><div className="survey-actions survey-export-actions"><button type="button" className="btn btn-primary" disabled={!exportBranchIds.length || exporting} onClick={exportPdf}>{exporting ? 'جاري تجهيز PDF...' : `تصدير PDF (${exportBranchIds.length} فرع)`}</button>{exportMonth !== getCurrentMonth() && responses.some((response) => response.month === exportMonth) && <button type="button" className="btn survey-danger" onClick={removeMonth}>حذف إجابات هذا الشهر نهائياً</button>}</div></section>}

    {selectedSurvey && exportBranches.length > 0 && <div className="survey-pdf-host" aria-hidden="true"><div ref={pdfRef}><SurveyPdfDocument survey={selectedSurvey} month={exportMonth} branches={exportBranches} responses={responses} /></div></div>}
    {selectedResponse && selectedSurvey && <SurveyResponseDetailsModal key={selectedResponse.response.id} response={selectedResponse.response} branch={selectedResponse.branch} survey={selectedSurvey} onClose={() => setSelectedResponse(null)} onUpdated={(updated) => { setResponses((current) => current.map((item) => item.id === updated.id ? updated : item)); setSelectedResponse({ ...selectedResponse, response: updated }); setMessage('تم تصحيح إجابة الفرع وحفظ سجل التعديل.'); }} />}
  </DashboardLayout>;
};

export default SurveysDashboard;
