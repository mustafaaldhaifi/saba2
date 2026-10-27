import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DashboardLayout from '../../layouts/DashboardLayout';
import { RESPONSE_STATUS, SURVEY_STATUS, formatMonth, getCurrentMonth, getRecentMonths } from './surveyConstants';
import { createSurvey, deleteSurveyMonth, deleteSurveyPermanently, getBranches, getResponsesForSurvey, getSurveys, updateSurvey, updateSurveyStatus } from './surveyService';
import SurveyEditor from './SurveyEditor';
import SurveyResponseDetailsModal from './SurveyResponseDetailsModal';
import SurveyPdfDocument from './SurveyPdfDocument';
import SurveyFieldPdfDocument from './SurveyFieldPdfDocument';
import { createSurveyFieldsWorkbook } from './surveyFieldExcel';
import { saveAs } from 'file-saver';
import { getLatestDueOccurrence, getResponseMonth, getSurveySchedule, listDueOccurrencesInMonth, occurrenceDateOfResponse } from './surveySchedule';
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
  const [selectedCell, setSelectedCell] = useState(null);
  const [exportMonth, setExportMonth] = useState(getCurrentMonth());
  const [exportBranchIds, setExportBranchIds] = useState([]);
  const [exportQuestionIds, setExportQuestionIds] = useState([]);
  const [exportFormat, setExportFormat] = useState('pdf');
  const [exportDate, setExportDate] = useState('');
  const [exporting, setExporting] = useState(false);
  const pdfRef = useRef(null);
  const fieldPdfRefs = useRef(new Map());

  const selectedSurvey = surveys.find((survey) => survey.id === selectedSurveyId) || null;
  const months = useMemo(() => [...new Set([...getRecentMonths(), ...responses.map(getResponseMonth).filter(Boolean)])].sort().reverse(), [responses]);
  const visibleBranches = useMemo(() => selectedSurvey ? branches.filter((branch) =>
    selectedSurvey.targetBranchIds?.includes(branch.id) || responses.some((response) => response.branchId === branch.id)) : [], [branches, responses, selectedSurvey]);
  const exportQuestions = useMemo(() => {
    const currentQuestions = selectedSurvey?.questions || [];
    const currentIds = new Set(currentQuestions.map((question) => question.id));
    const previousQuestions = responses
      .filter((response) => getResponseMonth(response) === exportMonth)
      .flatMap((response) => response.surveySnapshot?.questions || [])
      .filter((question, index, questions) => !currentIds.has(question.id) && questions.findIndex((item) => item.id === question.id) === index);
    return [...currentQuestions, ...previousQuestions.map((question) => ({ ...question, previous: true }))];
  }, [selectedSurvey, responses, exportMonth]);
  const selectedExportQuestions = exportQuestions.filter((question) => exportQuestionIds.includes(question.id));
  const exportDates = selectedSurvey ? [...new Set([
    ...listDueOccurrencesInMonth(selectedSurvey, exportMonth),
    ...responses.filter((response) => getResponseMonth(response) === exportMonth).map(occurrenceDateOfResponse).filter(Boolean),
  ])].sort().reverse() : [];
  const selectedExportDate = exportDates.includes(exportDate) ? exportDate : exportDates[0] || '';

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
  useEffect(() => { setExportQuestionIds([]); fieldPdfRefs.current.clear(); }, [selectedSurveyId]);

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
    const monthsCount = new Set(linkedResponses.map(getResponseMonth).filter(Boolean)).size;
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
    const count = responses.filter((response) => getResponseMonth(response) === exportMonth).length;
    if (!count) return;
    if (!window.confirm(`حذف ${count} إجابة لاستبيان «${selectedSurvey.title}» في ${formatMonth(exportMonth)} نهائياً؟`)) return;
    try {
      await deleteSurveyMonth(selectedSurvey.id, exportMonth);
      setResponses((current) => current.filter((response) => getResponseMonth(response) !== exportMonth));
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

  const exportSelectedFields = async () => {
    if (!selectedSurvey || !selectedExportDate || !exportBranches.length || !selectedExportQuestions.length) return;
    let completed = 0;
    try {
      setExporting(true);
      if (exportFormat === 'excel') {
        const workbook = await createSurveyFieldsWorkbook({ survey: selectedSurvey, questions: selectedExportQuestions, date: selectedExportDate, branches: exportBranches, responses });
        const buffer = await workbook.xlsx.writeBuffer();
        const filename = `استبيان_${selectedSurvey.title}_${selectedExportDate}.xlsx`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
        saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
        completed = selectedExportQuestions.length;
        setMessage(`تم تجهيز ملف Excel واحد يحتوي ${completed} ${completed === 1 ? 'تبويب' : 'تبويبات'}، تبويب لكل حقل.`);
      } else {
        const { default: html2pdf } = await import('html2pdf.js');
        for (const [index, question] of selectedExportQuestions.entries()) {
          const filename = `استبيان_${selectedSurvey.title}_${question.label}_${selectedExportDate}_${index + 1}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
          const element = fieldPdfRefs.current.get(question.id);
          if (!element) throw new Error(`تعذر تجهيز تقرير ${question.label}`);
          const blob = await html2pdf().set({
            margin: [8, 8, 8, 8],
            image: { type: 'jpeg', quality: 0.97 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: question.type === 'health_documents' ? 1020 : 720 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: question.type === 'health_documents' ? 'landscape' : 'portrait' },
            pagebreak: { mode: ['css', 'legacy'], avoid: ['tr'] },
          }).from(element).outputPdf('blob');
          saveAs(blob, `${filename}.pdf`);
          completed += 1;
        }
        setMessage(`تم تجهيز ${completed} ملفات PDF، ملف مستقل لكل حقل.`);
      }
    } catch (error) {
      setMessage(exportFormat === 'excel' ? 'تعذر إنشاء ملف Excel.' : `تعذر إكمال التصدير بعد تجهيز ${completed} من ${selectedExportQuestions.length} ملفات PDF.`);
      console.error(error);
    } finally { setExporting(false); }
  };

  const exportBranches = branches.filter((branch) => exportBranchIds.includes(branch.id));
  const getCellDates = (branchId, month) => [...new Set([
    ...listDueOccurrencesInMonth(selectedSurvey, month),
    ...responses.filter((response) => response.branchId === branchId && getResponseMonth(response) === month).map(occurrenceDateOfResponse).filter(Boolean),
  ])].sort().reverse();
  const getResponse = (branchId, date) => responses.find((response) => response.branchId === branchId && occurrenceDateOfResponse(response) === date);
  const latestDue = selectedSurvey ? getLatestDueOccurrence(selectedSurvey) : null;

  return <DashboardLayout title="إدارة الاستبيانات" role="admin">
    <div className="survey-admin-header"><div><h1>الاستبيانات الشهرية</h1><p>إنشاء الاستبيانات ومتابعة إجابات الفروع وتصديرها.</p></div><button type="button" className="btn btn-primary" onClick={() => setEditorSurvey(null)}>إضافة استبيان</button></div>
    {message && <div className="survey-message" role="status">{message}</div>}
    {editorSurvey !== undefined && <SurveyEditor key={editorSurvey?.id || 'new'} survey={editorSurvey} branches={branches} onSave={saveSurvey} onCancel={() => setEditorSurvey(undefined)} saving={isSaving} />}

    <section className="survey-list-section"><h2>الاستبيانات</h2>{isLoading ? <p>جاري التحميل...</p> : surveys.length === 0 ? <div className="card">لا توجد استبيانات بعد.</div> : <div className="survey-admin-list">{surveys.map((survey) => <article className="survey-admin-item card" key={survey.id}>
      <div><h3>{survey.title}</h3><p>{survey.description || 'بدون وصف'}</p><small>{survey.targetBranchIds?.length || 0} فرع · {({ daily: 'يومي', weekly: 'أسبوعي', month_start: 'بداية الشهر', month_end: 'نهاية الشهر' })[getSurveySchedule(survey).type]} · يبدأ {getSurveySchedule(survey).startDate}</small></div>
      <div className="survey-admin-actions"><span className={`survey-response-state ${survey.status}`}>{statusLabel[survey.status]}</span><button type="button" className="btn survey-secondary" onClick={() => setEditorSurvey(survey)}>تعديل</button>{survey.status === SURVEY_STATUS.ACTIVE ? <button type="button" className="btn survey-secondary" onClick={() => changeStatus(survey, SURVEY_STATUS.PAUSED)}>إيقاف</button> : <button type="button" className="btn survey-secondary" onClick={() => changeStatus(survey, SURVEY_STATUS.ACTIVE)}>تشغيل</button>}{survey.status !== SURVEY_STATUS.ARCHIVED && <button type="button" className="btn survey-secondary" onClick={() => changeStatus(survey, SURVEY_STATUS.ARCHIVED)}>أرشفة</button>}{survey.status === SURVEY_STATUS.ARCHIVED && <button type="button" className="btn survey-danger" onClick={() => removeSurvey(survey)}>حذف نهائي</button>}</div>
    </article>)}</div>}</section>

    <section className="survey-monitor card"><div className="survey-section-heading"><div><h2>متابعة الفروع حسب الشهر</h2><p>اضغط على الشهر لرؤية كل موعد وإجابة الفرع.</p></div>{surveys.length > 0 && <select className="input-field survey-select" value={selectedSurveyId} onChange={(event) => { setSelectedSurveyId(event.target.value); setSelectedResponse(null); setSelectedCell(null); }}><option value="" disabled>اختر الاستبيان</option>{surveys.map((survey) => <option key={survey.id} value={survey.id}>{survey.title}</option>)}</select>}</div>
      {responsesLoading && <p>جاري تحميل الإجابات...</p>}
      {selectedSurvey && <div className="survey-table-wrap"><table className="survey-monitor-table"><thead><tr><th>الفرع</th>{months.map((month) => <th key={month}>{formatMonth(month)}</th>)}</tr></thead><tbody>{visibleBranches.map((branch) => <tr key={branch.id}><td>{branch.name || branch.id}</td>{months.map((month) => { const dates = getCellDates(branch.id, month); const completed = dates.filter((date) => getResponse(branch.id, date)?.status === RESPONSE_STATUS.SUBMITTED).length; const state = dates.length === 0 ? 'not-applicable' : completed === dates.length ? 'submitted' : 'pending'; return <td key={month}>{dates.length ? <button type="button" className={`survey-response-state survey-state-button ${state}`} onClick={() => setSelectedCell({ branch, month })}>{completed} / {dates.length} تم</button> : <span className="survey-response-state not-applicable">—</span>}</td>; })}</tr>)}</tbody></table></div>}
      {selectedCell && selectedSurvey && <div className="survey-occurrences"><div className="survey-section-heading"><h3>{selectedCell.branch.name || selectedCell.branch.id} · {formatMonth(selectedCell.month)}</h3><button type="button" className="survey-close" onClick={() => setSelectedCell(null)}>×</button></div>{getCellDates(selectedCell.branch.id, selectedCell.month).map((date) => { const response = getResponse(selectedCell.branch.id, date); const state = response?.status || (latestDue && date < latestDue ? 'missed' : 'pending'); return <div className="survey-occurrence-row" key={date}><strong>{date}</strong><span className={`survey-response-state ${state}`}>{response?.status === RESPONSE_STATUS.SUBMITTED ? 'تم الإرسال' : response?.status === RESPONSE_STATUS.DRAFT ? 'مسودة' : state === 'missed' ? 'فات موعده' : 'بانتظار الإجابة'}</span>{response && <button type="button" className="btn survey-secondary" onClick={() => setSelectedResponse({ response, branch: selectedCell.branch })}>عرض التفاصيل</button>}</div>; })}</div>}
    </section>

    {selectedSurvey && <section className="survey-monitor card survey-export-panel">
      <h2>تصدير بيانات الاستبيان</h2>
      <p className="survey-helper">اختر التاريخ والفروع والحقول. في PDF يُنشأ ملف لكل حقل، وفي Excel ملف واحد بتبويب لكل حقل.</p>
      <div className="survey-form-grid">
        <label>الشهر<select className="input-field" value={exportMonth} onChange={(event) => { setExportMonth(event.target.value); setExportQuestionIds([]); setExportDate(''); }}>
          {months.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}
        </select></label>
        <label>تاريخ موعد الاستبيان<select className="input-field" value={selectedExportDate} onChange={(event) => setExportDate(event.target.value)} disabled={!exportDates.length}>
          <option value="" disabled>لا توجد مواعيد في هذا الشهر</option>
          {exportDates.map((date) => <option key={date} value={date}>{date}</option>)}
        </select></label>
        <label>نوع ملف الحقول<select className="input-field" value={exportFormat} onChange={(event) => setExportFormat(event.target.value)}>
          <option value="pdf">PDF</option>
          <option value="excel">Excel (.xlsx)</option>
        </select></label>
      </div>
      <fieldset className="survey-export-fields"><legend>حقول التقرير</legend>
        <div className="survey-export-fields-header"><span>{selectedExportQuestions.length} من {exportQuestions.length} حقل محدد</span>
          <button type="button" className="survey-text-button" onClick={() => setExportQuestionIds(selectedExportQuestions.length === exportQuestions.length ? [] : exportQuestions.map((question) => question.id))}>
            {selectedExportQuestions.length === exportQuestions.length ? 'إلغاء اختيار الكل' : 'اختيار الكل'}
          </button>
        </div>
        <div className="survey-checkbox-grid">{exportQuestions.map((question) => <label key={question.id}>
          <input type="checkbox" checked={exportQuestionIds.includes(question.id)} onChange={() => setExportQuestionIds((current) => current.includes(question.id) ? current.filter((id) => id !== question.id) : [...current, question.id])} />
          {question.label}{question.previous ? ' (حقل سابق)' : ''}
        </label>)}</div>
      </fieldset>
      <div className="survey-export-fields-header"><strong>الفروع المختارة: {exportBranches.length}</strong>
        <button type="button" className="survey-text-button" onClick={() => setExportBranchIds(exportBranches.length === branches.length ? [] : branches.map((branch) => branch.id))}>
          {exportBranches.length === branches.length ? 'إلغاء اختيار الكل' : 'اختيار الكل'}
        </button>
      </div>
      <div className="survey-checkbox-grid">{branches.map((branch) => <label key={branch.id}>
        <input type="checkbox" checked={exportBranchIds.includes(branch.id)} onChange={() => setExportBranchIds((current) => current.includes(branch.id) ? current.filter((id) => id !== branch.id) : [...current, branch.id])} />
        {branch.name || branch.id}
      </label>)}</div>
      <div className="survey-actions survey-export-actions">
        <button type="button" className="btn btn-primary" disabled={!selectedExportQuestions.length || !selectedExportDate || !exportBranches.length || exporting || responsesLoading} onClick={exportSelectedFields}>
          {exporting ? 'جاري تجهيز التصدير...' : exportFormat === 'excel' ? `تصدير ملف Excel (${selectedExportQuestions.length} ${selectedExportQuestions.length === 1 ? 'تبويب' : 'تبويبات'})` : `تصدير ${selectedExportQuestions.length} ${selectedExportQuestions.length === 1 ? 'ملف PDF' : 'ملفات PDF'}`}
        </button>
        <button type="button" className="btn survey-secondary" disabled={!exportBranches.length || exporting || responsesLoading} onClick={exportPdf}>تصدير التقرير الشامل PDF</button>
        {exportMonth !== getCurrentMonth() && responses.some((response) => getResponseMonth(response) === exportMonth) && <button type="button" className="btn survey-danger" onClick={removeMonth}>حذف إجابات هذا الشهر نهائياً</button>}
      </div>
    </section>}
    {selectedSurvey && exportBranches.length > 0 && <div className="survey-pdf-host" aria-hidden="true"><div ref={pdfRef}><SurveyPdfDocument survey={selectedSurvey} month={exportMonth} branches={exportBranches} responses={responses} /></div>{exportFormat === 'pdf' && selectedExportQuestions.map((question) => <div key={question.id} ref={(node) => { if (node) fieldPdfRefs.current.set(question.id, node); else fieldPdfRefs.current.delete(question.id); }}><SurveyFieldPdfDocument survey={selectedSurvey} question={question} date={selectedExportDate} branches={exportBranches} responses={responses} /></div>)}</div>}
    {selectedResponse && selectedSurvey && <SurveyResponseDetailsModal key={selectedResponse.response.id} response={selectedResponse.response} branch={selectedResponse.branch} survey={selectedSurvey} onClose={() => setSelectedResponse(null)} onUpdated={(updated) => { setResponses((current) => current.map((item) => item.id === updated.id ? updated : item)); setSelectedResponse({ ...selectedResponse, response: updated }); setMessage('تم تصحيح إجابة الفرع وحفظ سجل التعديل.'); }} />}
  </DashboardLayout>;
};

export default SurveysDashboard;
