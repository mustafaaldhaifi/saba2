import { useEffect, useState } from 'react';
import DashboardLayout from '../../layouts/DashboardLayout';
import { getBranchStockVisibility, loadBranches, saveBranchStockVisibility } from './branchesService';
import './branches.css';

/**
 * Shows branch records and controls their daily stock column visibility.
 * 1. Load existing branches and select one, several, or all active branches.
 * 2. Apply one shared hide/show choice to both daily stock columns.
 */
const BranchesManager = () => {
  const [branches, setBranches] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [action, setAction] = useState('hide');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const activeIds = branches.filter((branch) => branch.status !== 'archived').map((branch) => branch.id);
  const allSelected = activeIds.length > 0 && activeIds.every((id) => selectedIds.includes(id));

  const reload = async () => {
    setBranches(await loadBranches());
    localStorage.removeItem('saba_admin_branches');
  };

  useEffect(() => {
    let active = true;
    loadBranches().then((items) => { if (active) setBranches(items); })
      .catch((cause) => { console.error(cause); if (active) setError('تعذر تحميل الفروع. حدّث الصفحة.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const toggleBranch = (branchId) => {
    setSelectedIds((current) => current.includes(branchId)
      ? current.filter((id) => id !== branchId) : [...current, branchId]);
  };

  /**
   * Applies one stock-column action to the selected branch records.
   * 1. Require at least one selected active branch.
   * 2. Save the combined preference and reload the resulting list.
   */
  const submit = async (event) => {
    event.preventDefault();
    // STEP 1: Avoid an accidental update when no branch is checked.
    if (!selectedIds.length) { setError('حدد فرعًا واحدًا على الأقل.'); return; }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      // STEP 2: Update both columns together for the selected branches only.
      const count = await saveBranchStockVisibility(branches, selectedIds, action === 'hide');
      await reload();
      setSelectedIds([]);
      setMessage(`تم ${action === 'hide' ? 'إخفاء' : 'إظهار'} العمودين في ${count} فرع.`);
    } catch (cause) {
      await reload().catch(() => {});
      setSelectedIds([]);
      setError(cause.code === 'permission-denied' ? 'قواعد قاعدة البيانات لا تسمح بحفظ الإعداد لهذا الحساب.' : cause.message || 'تعذر تطبيق الإعداد على الفروع.');
    } finally { setSaving(false); }
  };

  return <DashboardLayout title="إدارة الفروع" role="admin">
    <div className="branches-page" dir="rtl">
      <header><h1>الفروع</h1><p>إعداد عرض عمودَي الموجودة والمتبقي في الجرد اليومي لكل فرع.</p></header>
      {message && <p className="branches-success" role="status">{message}</p>}
      {error && <p className="branches-error" role="alert">{error}</p>}
      <form className="card branches-form" onSubmit={submit}>
        <h2>إخفاء أو إظهار أعمدة الجرد</h2>
        <p className="branches-hint">حدد الفروع من القائمة، ثم اختر الإجراء. عمودا الموجودة والمتبقي يتغيران معًا.</p>
        <label className="branches-toggle"><input type="checkbox" checked={allSelected} disabled={saving || loading || activeIds.length === 0} onChange={(event) => setSelectedIds(event.target.checked ? activeIds : [])} /><span>تحديد جميع الفروع النشطة ({activeIds.length})</span></label>
        <label className="branches-bulk-action">الإجراء<select className="input-field" value={action} onChange={(event) => setAction(event.target.value)}><option value="hide">إخفاء العمودين</option><option value="show">إظهار العمودين</option></select></label>
        <div className="branches-actions"><button className="btn btn-primary" disabled={saving || loading || selectedIds.length === 0}>{saving ? 'جارٍ الحفظ...' : `تطبيق على ${selectedIds.length} فرع`}</button></div>
      </form>
      <section className="card branches-list">
        <h2>الفروع الحالية</h2>
        {loading ? <p>جارٍ تحميل الفروع...</p> : branches.length === 0 ? <p>لا توجد فروع.</p> :
          <div className="branches-table-wrap"><table>
            <thead><tr><th>تحديد</th><th>الفرع</th><th>رمز الدخول</th><th>المدينة</th><th>أعمدة المخزون</th><th>الحالة</th></tr></thead>
            <tbody>{branches.map((branch) => <tr key={branch.id}>
              <td data-label="تحديد"><input type="checkbox" aria-label={`تحديد فرع ${branch.name || branch.id}`} checked={selectedIds.includes(branch.id)} disabled={saving || branch.status === 'archived'} onChange={() => toggleBranch(branch.id)} /></td>
              <td data-label="الفرع">{branch.name || branch.id}</td>
              <td data-label="رمز الدخول" dir="ltr">{branch.loginName || branch.name}</td>
              <td data-label="المدينة">{branch.city === 'other' ? 'خارج الرياض' : 'الرياض'}</td>
              <td data-label="أعمدة المخزون">{getBranchStockVisibility(branch) ? 'مخفية' : 'ظاهرة'}</td>
              <td data-label="الحالة">{branch.status === 'archived' ? 'مؤرشف' : 'نشط'}</td>
            </tr>)}</tbody>
          </table></div>}
      </section>
    </div>
  </DashboardLayout>;
};

export default BranchesManager;
