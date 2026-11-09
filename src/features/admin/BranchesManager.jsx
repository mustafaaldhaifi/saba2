import { useEffect, useState } from 'react';
import DashboardLayout from '../../layouts/DashboardLayout';
import { loadBranches, saveBranchChange } from './branchesService';
import './branches.css';

const blankForm = { name: '', city: 'ryad', password: '' };

/**
 * Manages branch records and their login accounts from the administration page.
 * 1. Load current branches and prepare a create or edit form.
 * 2. Send confirmed changes to the trusted account manager.
 * 3. Reload the list after success so the page reflects stored data.
 */
const BranchesManager = () => {
  const [branches, setBranches] = useState([]);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(blankForm);
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

  const startEdit = (branch) => {
    setEditingId(branch.id);
    setForm({ name: branch.name || '', city: branch.city || 'ryad', password: '' });
    setError('');
    setMessage('');
  };

  /**
   * Saves a branch after a submitted form and refreshes its stored status.
   * 1. Send the validated change through the trusted service.
   * 2. Reload the directory and reset the form on success.
   */
  const submit = async (event) => {
    event.preventDefault();
    // STEP 1: The service validates the form and performs the authenticated write.
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await saveBranchChange(editingId ? 'update' : 'create', { ...form, id: editingId });
      // STEP 2: Read the committed branch list and clear the form.
      await reload();
      setForm(blankForm);
      setEditingId('');
      setMessage(result.email ? `تم إنشاء الفرع. حساب الدخول: ${result.email}` : 'تم حفظ بيانات الفرع بنجاح.');
    } catch (cause) {
      setError(cause.message || 'تعذر إكمال العملية. حدّث القائمة قبل المحاولة مجددًا.');
    } finally { setSaving(false); }
  };

  /**
   * Removes a branch from active use while retaining its past records.
   * 1. Confirm the administrator's choice.
   * 2. Disable the account through the server and reload stored status.
   */
  const remove = async (branch) => {
    // STEP 1: Historical branch IDs are retained to protect existing records.
    if (!window.confirm(`حذف فرع «${branch.name}» من الفروع النشطة وتعطيل حساب دخوله؟ ستُحفظ بياناته السابقة.`)) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      // STEP 2: The server handles account disabling and archival together.
      const result = await saveBranchChange('delete', branch);
      await reload();
      if (editingId === branch.id) { setEditingId(''); setForm(blankForm); }
      setMessage(result.archived ? 'أُرشف الفرع وتعطّل حساب دخوله مع حفظ بياناته السابقة.' : 'تم حذف الفرع.');
    } catch (cause) {
      setError(cause.message || 'تعذر حذف الفرع.');
    } finally { setSaving(false); }
  };

  return <DashboardLayout title="إدارة الفروع" role="admin">
    <div className="branches-page" dir="rtl">
      <header><h1>إدارة الفروع</h1><p>أضف الفروع وعدّل بياناتها وتابع حالة حسابات الدخول.</p></header>
      {message && <p className="branches-success" role="status">{message}</p>}
      {error && <p className="branches-error" role="alert">{error}</p>}
      <form className="card branches-form" onSubmit={submit}>
        <h2>{editingId ? 'تعديل الفرع' : 'إضافة فرع'}</h2>
        <div className="branches-fields">
          <label>اسم الفرع<input className="input-field" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required minLength="2" maxLength="80" /><small>{editingId ? 'يبقى حساب الدخول الحالي ثابتًا عند تعديل الاسم.' : 'سيُنشئ النظام حساب الدخول تلقائيًا من اسم الفرع.'}</small></label>
          <label>المدينة<select className="input-field" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })}><option value="ryad">الرياض</option><option value="other">خارج الرياض</option></select></label>
          {!editingId && <label>كلمة المرور الأولية<input className="input-field" type="password" minLength="8" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></label>}
        </div>
        <div className="branches-actions"><button className="btn btn-primary" disabled={saving}>{saving ? 'جارٍ الحفظ...' : editingId ? 'حفظ التعديل' : 'إضافة الفرع'}</button>{editingId && <button type="button" className="btn" disabled={saving} onClick={() => { setEditingId(''); setForm(blankForm); }}>إلغاء التعديل</button>}</div>
      </form>
      <section className="card branches-list"><h2>الفروع الحالية</h2>{loading ? <p>جارٍ تحميل الفروع...</p> : branches.length === 0 ? <p>لا توجد فروع.</p> : <div className="branches-table-wrap"><table><thead><tr><th>الفرع</th><th>رمز الدخول</th><th>المدينة</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{branches.map((branch) => <tr key={branch.id}><td>{branch.name || branch.id}</td><td dir="ltr">{branch.loginName || branch.name}</td><td>{branch.city === 'other' ? 'خارج الرياض' : 'الرياض'}</td><td>{branch.status === 'archived' ? 'مؤرشف' : 'نشط'}</td><td><div className="branches-actions"><button type="button" className="btn" disabled={saving} onClick={() => startEdit(branch)}>تعديل</button>{branch.status !== 'archived' && <button type="button" className="btn branches-delete" disabled={saving} onClick={() => remove(branch)}>حذف</button>}</div></td></tr>)}</tbody></table></div>}</section>
    </div>
  </DashboardLayout>;
};

export default BranchesManager;
