import { useEffect, useState } from 'react';
import DashboardLayout from '../../layouts/DashboardLayout';
import { loadBranches, saveBranchStockVisibility } from './branchesService';
import './branches.css';

/**
 * Shows branch records and controls their daily stock column visibility.
 * 1. Load existing branches and select one for display settings.
 * 2. Save only its visibility preference and reload the stored value.
 */
const BranchesManager = () => {
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [hideDailyStockColumns, setHideDailyStockColumns] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

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

  const selectBranch = (branch) => {
    setSelectedBranch(branch);
    setHideDailyStockColumns(branch.hideDailyStockColumns === true);
    setError('');
    setMessage('');
  };

  /**
   * Saves one existing branch's stock column preference.
   * 1. Write only the preference to the selected branch record.
   * 2. Reload the directory and clear the selection after success.
   */
  const submit = async (event) => {
    event.preventDefault();
    // STEP 1: No branch record or account is created or removed here.
    if (!selectedBranch) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await saveBranchStockVisibility(selectedBranch.id, hideDailyStockColumns);
      // STEP 2: Show the value confirmed by Firestore.
      await reload();
      setSelectedBranch(null);
      setMessage('تم حفظ إعداد عرض الأعمدة.');
    } catch (cause) {
      setError(cause.code === 'permission-denied' ? 'قواعد قاعدة البيانات لا تسمح بحفظ الإعداد لهذا الحساب.' : cause.message || 'تعذر حفظ الإعداد. حدّث الصفحة وحاول مجددًا.');
    } finally { setSaving(false); }
  };

  return <DashboardLayout title="إدارة الفروع" role="admin">
    <div className="branches-page" dir="rtl">
      <header><h1>الفروع</h1><p>إعداد عرض عمودَي الموجودة والمتبقي في الجرد اليومي لكل فرع.</p></header>
      {message && <p className="branches-success" role="status">{message}</p>}
      {error && <p className="branches-error" role="alert">{error}</p>}
      {selectedBranch && <form className="card branches-form" onSubmit={submit}>
        <h2>إعداد أعمدة الجرد: {selectedBranch.name || selectedBranch.id}</h2>
        <label className="branches-toggle"><input type="checkbox" checked={hideDailyStockColumns} onChange={(event) => setHideDailyStockColumns(event.target.checked)} /><span>إخفاء عمودَي الموجودة والمتبقي عن الفرع</span></label>
        <p className="branches-hint">تُخفى الأعمدة من جدول الفرع، وتظهر خانات منفصلة لأي رصيد افتتاحي ناقص. تبقى حسابات الجرد كما هي.</p>
        <div className="branches-actions"><button className="btn btn-primary" disabled={saving}>{saving ? 'جارٍ الحفظ...' : 'حفظ إعداد الأعمدة'}</button><button type="button" className="btn" disabled={saving} onClick={() => setSelectedBranch(null)}>إلغاء</button></div>
      </form>}
      <section className="card branches-list">
        <h2>الفروع الحالية</h2>
        {loading ? <p>جارٍ تحميل الفروع...</p> : branches.length === 0 ? <p>لا توجد فروع.</p> :
          <div className="branches-table-wrap"><table>
            <thead><tr><th>الفرع</th><th>رمز الدخول</th><th>المدينة</th><th>أعمدة المخزون</th><th>الحالة</th><th>الإعدادات</th></tr></thead>
            <tbody>{branches.map((branch) => <tr key={branch.id}>
              <td data-label="الفرع">{branch.name || branch.id}</td>
              <td data-label="رمز الدخول" dir="ltr">{branch.loginName || branch.name}</td>
              <td data-label="المدينة">{branch.city === 'other' ? 'خارج الرياض' : 'الرياض'}</td>
              <td data-label="أعمدة المخزون">{branch.hideDailyStockColumns === true ? 'مخفية للفرع' : 'ظاهرة'}</td>
              <td data-label="الحالة">{branch.status === 'archived' ? 'مؤرشف' : 'نشط'}</td>
              <td data-label="الإعدادات"><button type="button" className="btn" disabled={saving} onClick={() => selectBranch(branch)}>إعداد الأعمدة</button></td>
            </tr>)}</tbody>
          </table></div>}
      </section>
    </div>
  </DashboardLayout>;
};

export default BranchesManager;
