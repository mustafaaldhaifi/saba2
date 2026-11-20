import { useEffect, useState } from 'react';
import DashboardLayout from '../../layouts/DashboardLayout';
import { DAILY_INVENTORY_COLUMNS, getHiddenDailyInventoryColumns, loadBranches, saveBranchStockVisibility } from './branchesService';
import { banBranch, grantBanAttempt, initializeBranchBans, loadBanAttempts, unbanBranch } from './banService';
import { getZonedDateTime, scheduledDateTime, SURVEY_TIMEZONE } from '../surveys/surveySchedule';
import './branches.css';

/**
 * Shows branch records and manages their stock columns, bans, and attempts.
 * 1. Load branches and attempts, then initialize older ban fields.
 * 2. Apply stock-column choices, administrative bans, releases, or time-limited attempts.
 */
const BranchesManager = () => {
  const [branches, setBranches] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [columnChoices, setColumnChoices] = useState({});
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editingBanId, setEditingBanId] = useState('');
  const [banMessage, setBanMessage] = useState('');
  const [banSavingId, setBanSavingId] = useState('');
  const [attempts, setAttempts] = useState({});
  const [editingAttemptId, setEditingAttemptId] = useState('');
  const [attemptUntil, setAttemptUntil] = useState('');
  const activeIds = branches.filter((branch) => branch.status !== 'archived').map((branch) => branch.id);
  const visibleBranches = branches.filter((branch) =>
    (cityFilter === 'all' || (branch.city === 'other' ? 'other' : 'riyadh') === cityFilter) &&
    `${branch.name || ''} ${branch.loginName || ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const visibleActiveIds = visibleBranches.filter((branch) => branch.status !== 'archived').map((branch) => branch.id);
  const allSelected = visibleActiveIds.length > 0 && visibleActiveIds.every((id) => selectedIds.includes(id));
  const changedColumns = Object.entries(columnChoices).filter(([, choice]) => choice !== 'keep');

  const reload = async () => {
    const [items, activeAttempts] = await Promise.all([loadBranches(), loadBanAttempts()]);
    setBranches(items);
    setAttempts(activeAttempts);
    localStorage.removeItem('saba_admin_branches');
  };

  useEffect(() => {
    let active = true;
    Promise.all([loadBranches(), loadBanAttempts()]).then(async ([items, activeAttempts]) => {
      if (!active) return;
      setBranches(items);
      setAttempts(activeAttempts);
      await initializeBranchBans(items);
      if (active && items.some((item) => !Object.hasOwn(item, 'ban'))) setBranches(await loadBranches());
    })
      .catch((cause) => { console.error(cause); if (active) setError('تعذر تحميل الفروع أو تهيئة حالة الحظر. حدّث الصفحة.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const toggleBranch = (branchId) => {
    setSelectedIds((current) => current.includes(branchId)
      ? current.filter((id) => id !== branchId) : [...current, branchId]);
  };

  /**
   * Applies one stock-column action to the selected branch records.
   * 1. Require selected active branches and at least one changed column.
   * 2. Save only chosen column changes and reload the resulting list.
   */
  const submit = async (event) => {
    event.preventDefault();
    // STEP 1: Avoid an accidental update when no branch is checked.
    if (!selectedIds.length || !changedColumns.length) { setError('حدد الفروع وعمودًا واحدًا على الأقل لتغييره.'); return; }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      // STEP 2: Preserve every column left unchanged for each branch.
      const count = await saveBranchStockVisibility(branches, selectedIds, Object.fromEntries(changedColumns.map(([id, choice]) => [id, choice === 'hide'])));
      await reload();
      setSelectedIds([]);
      setColumnChoices({});
      setMessage(`تم حفظ إعدادات ${changedColumns.length} عمود في ${count} فرع.`);
    } catch (cause) {
      await reload().catch(() => {});
      setSelectedIds([]);
      setError(cause.code === 'permission-denied' ? 'قواعد قاعدة البيانات لا تسمح بحفظ الإعداد لهذا الحساب.' : cause.message || 'تعذر تطبيق الإعداد على الفروع.');
    } finally { setSaving(false); }
  };

  /**
   * Saves an administrative ban or clears the current branch ban.
   * 1. Submit the selected action through the shared ban service.
   * 2. Refresh the list and show the resulting status.
   */
  const changeBan = async (branch, shouldBan) => {
    // STEP 1: Reject an empty reason before writing either collection.
    if (shouldBan && !banMessage.trim()) { setError('اكتب سبب الحظر.'); return; }
    setBanSavingId(branch.id);
    setError('');
    setMessage('');
    try {
      if (shouldBan) await banBranch(branch.id, banMessage);
      else await unbanBranch(branch.id);
      // STEP 2: Show the persisted branch status and close the editor.
      await reload();
      setEditingBanId('');
      setBanMessage('');
      setMessage(`تم ${shouldBan ? 'حظر' : 'إبطال حظر'} فرع ${branch.name || branch.id}.`);
    } catch (cause) {
      setError(cause.code === 'permission-denied' ? 'قواعد قاعدة البيانات لا تسمح بإدارة الحظر لهذا الحساب.' : cause.message || 'تعذر حفظ حالة الحظر.');
    } finally { setBanSavingId(''); }
  };

  /**
   * Grants a single attempt until the administrator's selected Riyadh time.
   * 1. Convert the selected local clock time and validate it.
   * 2. Save the attempt, then refresh branch and attempt status.
   */
  const addAttempt = async (branch) => {
    // STEP 1: The selected value is interpreted in Riyadh time for every branch.
    if (!attemptUntil) { setError('حدد وقت انتهاء المحاولة.'); return; }
    setBanSavingId(branch.id);
    setError('');
    setMessage('');
    try {
      const [date, time] = attemptUntil.split('T');
      const expiresAt = scheduledDateTime(date, { timezone: SURVEY_TIMEZONE, startTime: time });
      // STEP 2: The shared service clears only the ban linked to this attempt.
      await grantBanAttempt(branch.id, expiresAt);
      await reload();
      setEditingAttemptId('');
      setAttemptUntil('');
      setMessage(`أُضيفت محاولة واحدة لفرع ${branch.name || branch.id} حتى ${date} ${time} بتوقيت الرياض.`);
    } catch (cause) {
      setError(cause.code === 'permission-denied' ? 'قواعد قاعدة البيانات لا تسمح بمنح المحاولة لهذا الحساب.' : cause.message || 'تعذر إضافة المحاولة.');
    } finally { setBanSavingId(''); }
  };

  return <DashboardLayout title="إدارة الفروع" role="admin">
    <div className="branches-page" dir="rtl">
      <header><h1>الفروع</h1><p>اختر الفروع، ثم اضبط ظهور أعمدة الجرد لكل فرع مع إدارة حالة الحظر.</p></header>
      {message && <p className="branches-success" role="status">{message}</p>}
      {error && <p className="branches-error" role="alert">{error}</p>}
      <form className="card branches-form" onSubmit={submit}>
        <div className="branches-setup-heading"><div><span className="branches-step">01 / إعداد الجرد</span><h2>لوحة ظهور الأعمدة</h2><p className="branches-hint">اختر حالة كل عمود. «دون تغيير» يحافظ على إعداد الفرع الحالي.</p></div><strong>{selectedIds.length} فرع محدد</strong></div>
        <div className="branches-column-grid">{DAILY_INVENTORY_COLUMNS.map((column) => <div className="branches-column-card" key={column.id}>
          <div><strong>{column.label}</strong><small>ظاهر في {branches.filter((branch) => branch.status !== 'archived' && !getHiddenDailyInventoryColumns(branch).includes(column.id)).length} من {activeIds.length} فرع</small></div>
          <select className="input-field" aria-label={`ظهور عمود ${column.label}`} value={columnChoices[column.id] || 'keep'} onChange={(event) => setColumnChoices((current) => ({ ...current, [column.id]: event.target.value }))}>
            <option value="keep">دون تغيير</option><option value="show">إظهار</option><option value="hide">إخفاء</option>
          </select>
        </div>)}</div>
        <div className="branches-preview" aria-live="polite"><strong>معاينة التغيير</strong><span>{selectedIds.length ? `على ${selectedIds.length} فرع` : 'اختر الفروع من القائمة أدناه'}</span>
          <span>إخفاء: {changedColumns.filter(([, choice]) => choice === 'hide').map(([id]) => DAILY_INVENTORY_COLUMNS.find((column) => column.id === id)?.label).join('، ') || 'لا شيء'}</span>
          <span>إظهار: {changedColumns.filter(([, choice]) => choice === 'show').map(([id]) => DAILY_INVENTORY_COLUMNS.find((column) => column.id === id)?.label).join('، ') || 'لا شيء'}</span>
        </div>
        <div className="branches-actions"><span>سيُعدَّل {changedColumns.length} عمود في {selectedIds.length} فرع</span><button className="btn btn-primary" disabled={saving || loading || !selectedIds.length || !changedColumns.length}>{saving ? 'جارٍ الحفظ...' : 'حفظ إعدادات الأعمدة'}</button></div>
      </form>
      <section className="card branches-list">
        <div className="branches-list-heading"><div><span className="branches-step">02 / اختيار الفروع</span><h2>الفروع الحالية</h2></div><div className="branches-filters"><input className="input-field" type="search" placeholder="ابحث عن فرع" aria-label="ابحث عن فرع" value={search} onChange={(event) => setSearch(event.target.value)} /><select className="input-field" aria-label="تصفية المدينة" value={cityFilter} onChange={(event) => setCityFilter(event.target.value)}><option value="all">كل المدن</option><option value="riyadh">الرياض</option><option value="other">خارج الرياض</option></select></div></div>
        <label className="branches-toggle"><input type="checkbox" checked={allSelected} disabled={saving || loading || !visibleActiveIds.length} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, ...visibleActiveIds])] : current.filter((id) => !visibleActiveIds.includes(id)))} /><span>تحديد الفروع المعروضة ({visibleActiveIds.length})</span></label>
        {loading ? <p>جارٍ تحميل الفروع...</p> : branches.length === 0 ? <p>لا توجد فروع.</p> :
          <div className="branches-table-wrap"><table>
            <thead><tr><th>تحديد</th><th>الفرع</th><th>رمز الدخول</th><th>المدينة</th><th>أعمدة الجرد</th><th>الحالة</th><th>حالة الحظر</th></tr></thead>
            <tbody>{visibleBranches.map((branch) => {
              const attemptExpired = attempts[branch.id]?.status === 'active' && attempts[branch.id].expiresAt?.toDate?.() <= new Date();
              return <tr key={branch.id}>
              <td data-label="تحديد"><input type="checkbox" aria-label={`تحديد فرع ${branch.name || branch.id}`} checked={selectedIds.includes(branch.id)} disabled={saving || branch.status === 'archived'} onChange={() => toggleBranch(branch.id)} /></td>
              <td data-label="الفرع">{branch.name || branch.id}</td>
              <td data-label="رمز الدخول" dir="ltr">{branch.loginName || branch.name}</td>
              <td data-label="المدينة">{branch.city === 'other' ? 'خارج الرياض' : 'الرياض'}</td>
              <td data-label="أعمدة الجرد"><span>{getHiddenDailyInventoryColumns(branch).length
                ? `المخفية: ${getHiddenDailyInventoryColumns(branch).map((id) => DAILY_INVENTORY_COLUMNS.find((column) => column.id === id)?.label).join('، ')}`
                : 'كل الأعمدة ظاهرة'}</span>{branch.status !== 'archived' && <button type="button" className="branches-row-action" onClick={() => { setSelectedIds([branch.id]); document.querySelector('.branches-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>ضبط هذا الفرع</button>}</td>
              <td data-label="الحالة">{branch.status === 'archived' ? 'مؤرشف' : 'نشط'}</td>
              <td data-label="حالة الحظر">
                <div className="branches-ban-status">
                  <span className={typeof branch.ban === 'string' || attemptExpired ? 'branches-ban-active' : 'branches-ban-clear'}>{typeof branch.ban === 'string' || attemptExpired ? 'محظور' : 'غير محظور'}</span>
                  {typeof branch.ban === 'string' && <small>{branch.ban}</small>}
                  {attemptExpired ? <small>انتهت مهلة المحاولة الإضافية.</small> : attempts[branch.id]?.status === 'active' && <small>محاولة إضافية حتى {attempts[branch.id].expiresAt?.toDate?.().toLocaleString('ar-SA', { timeZone: SURVEY_TIMEZONE })}</small>}
                  {editingAttemptId === branch.id && <div className="branches-ban-editor">
                    <label>تنتهي المحاولة (بتوقيت الرياض)<input type="datetime-local" className="input-field" value={attemptUntil} onChange={(event) => setAttemptUntil(event.target.value)} disabled={!!banSavingId} /></label>
                    <div className="branches-ban-buttons"><button type="button" className="btn btn-primary" disabled={!!banSavingId || !attemptUntil} onClick={() => addAttempt(branch)}>منح محاولة واحدة</button><button type="button" className="btn" disabled={!!banSavingId} onClick={() => { setEditingAttemptId(''); setAttemptUntil(''); }}>إلغاء</button></div>
                  </div>}
                  {branch.status !== 'archived' && (editingBanId === branch.id ? <div className="branches-ban-editor">
                    <input className="input-field" aria-label={`سبب حظر ${branch.name || branch.id}`} value={banMessage} onChange={(event) => setBanMessage(event.target.value)} maxLength={500} placeholder="سبب الحظر الإداري" disabled={!!banSavingId} />
                    <div className="branches-ban-buttons"><button type="button" className="btn btn-primary" disabled={!!banSavingId || !banMessage.trim()} onClick={() => changeBan(branch, true)}>تأكيد الحظر</button><button type="button" className="btn" disabled={!!banSavingId} onClick={() => { setEditingBanId(''); setBanMessage(''); }}>إلغاء</button></div>
                  </div> : <div className="branches-ban-buttons">
                    {(typeof branch.ban === 'string' || attempts[branch.id]?.status === 'active') && <button type="button" className="btn" disabled={!!banSavingId} onClick={() => changeBan(branch, false)}>{banSavingId === branch.id ? 'جارٍ الحفظ...' : 'فك مباشر'}</button>}
                    {typeof branch.ban === 'string' && <button type="button" className="btn" disabled={!!banSavingId} onClick={() => { setEditingAttemptId(branch.id); setEditingBanId(''); setAttemptUntil(`${getZonedDateTime(new Date(Date.now() + 86_400_000)).date}T23:59`); }}>محاولة إضافية</button>}
                    <button type="button" className="btn" disabled={!!banSavingId} onClick={() => { setEditingBanId(branch.id); setBanMessage(''); }}>حظر إداري</button>
                  </div>)}
                </div>
              </td>
            </tr>})}</tbody>
          </table></div>}
      </section>
    </div>
  </DashboardLayout>;
};

export default BranchesManager;
