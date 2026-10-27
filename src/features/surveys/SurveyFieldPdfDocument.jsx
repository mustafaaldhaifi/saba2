import { QUESTION_TYPES } from './surveyConstants';
import { buildSurveyFieldReport } from './surveyFieldReportData';

const expandLongRows = (rows, type) => {
  const limit = type === QUESTION_TYPES.HEALTH_DOCUMENTS ? 48 : type === QUESTION_TYPES.YES_NO ? 140 : type === QUESTION_TYPES.NOTES ? 250 : 90;
  return rows.flatMap((row) => {
    const chunks = row.cells.map((cell) => {
      const characters = Array.from(String(cell));
      const parts = [];
      for (let index = 0; index < characters.length; index += limit) parts.push(characters.slice(index, index + limit).join(''));
      return parts.length ? parts : [''];
    });
    const count = Math.max(...chunks.map((parts) => parts.length));
    return Array.from({ length: count }, (_, index) => ({
      key: `${row.key}-${index}`,
      cells: row.cells.map((cell, cellIndex) => index === 0 ? chunks[cellIndex][0] : cellIndex === 0 ? `${row.cells[0]} (تابع)` : cellIndex === 1 ? row.cells[1] : chunks[cellIndex][index] || '—'),
    }));
  });
};

const pagesFor = (rows, type) => {
  const perPage = type === QUESTION_TYPES.HEALTH_DOCUMENTS ? 5 : type === QUESTION_TYPES.NOTES ? 5 : type === QUESTION_TYPES.YES_NO ? 6 : 10;
  const pages = [];
  for (let index = 0; index < rows.length; index += perPage) pages.push(rows.slice(index, index + perPage));
  return pages.length ? pages : [[]];
};

const SurveyFieldPdfDocument = ({ survey, question, date, branches, responses }) => {
  const { columns, rows } = buildSurveyFieldReport({ survey, question, date, branches, responses });
  const pages = pagesFor(expandLongRows(rows, question.type), question.type);
  return <div className={`survey-pdf survey-field-report${question.type === QUESTION_TYPES.HEALTH_DOCUMENTS ? ' survey-field-report-wide' : ''}`} dir="rtl">
    {pages.map((pageRows, pageIndex) => <section className="survey-field-report-page" key={pageIndex}>
      <header className="survey-pdf-header"><div><span className="survey-pdf-kicker">نظام سبأ · تقرير حقل الاستبيان</span><h1>{question.label}</h1><p>{survey.title}</p></div><div className="survey-field-report-date">تاريخ الموعد<strong>{date}</strong></div></header>
      <div className="survey-field-report-summary"><span>الفروع المختارة: <strong>{branches.length}</strong></span><span>صفحة {pageIndex + 1} من {pages.length}</span></div>
      <table className="survey-field-report-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{pageRows.map((row) => <tr key={row.key}>
        {row.cells.map((value, index) => <td key={index} className={`${index === 0 ? 'survey-field-report-branch ' : ''}${Number(value) < 0 || value === 'غير موجودة' || value === 'لا' || value.startsWith('تاريخ غير صالح') ? 'survey-pdf-alert' : ''}`.trim() || undefined}>{value}</td>)}
      </tr>)}</tbody></table>
      <footer>تقرير حقل «{question.label}» · {date} · العدد السالب يعني أن الوثيقة انتهت صلاحيتها.</footer>
    </section>)}
  </div>;
};

export default SurveyFieldPdfDocument;
