import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { getZonedDateTime } from '../surveys/surveySchedule';
import './dailyInventoryConstraint.css';

const SETTING_ID = 'daily_inventory_deadline';

/**
 * Configure the shared deadline for every branch's daily inventory entry.
 * 1. Read the current rule from the existing settings collection.
 * 2. Let the administrator choose the number of full grace days.
 * 3. Save a rule that starts with today's Riyadh report date.
 */
export default function DailyInventoryConstraint() {
  // STEP 1: Show the saved rule, including changes made in another admin session.
  const [rule, setRule] = useState(null);
  const [graceDays, setGraceDays] = useState('1');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => onSnapshot(doc(db, 'settings', SETTING_ID), (snapshot) => {
    const current = snapshot.exists() ? snapshot.data() : null;
    setRule(current);
    setGraceDays(String(current?.graceDays ?? 1));
    setLoading(false);
  }, () => {
    setError('تعذر تحميل إعداد المهلة. أعد فتح القسم.');
    setLoading(false);
  }), []);

  // STEP 2: A duration is the count of complete dates after the report date.
  const options = Array.from({ length: 31 }, (_, days) => days);
  const days = Number(graceDays);
  const exampleLastDay = new Date(Date.UTC(2026, 10, 15 + days)).toISOString().slice(0, 10);
  const exampleBanDay = new Date(Date.UTC(2026, 10, 16 + days)).toISOString().slice(0, 10);

  /**
   * Save a new rule version without applying it to report dates before today.
   * 1. Check administrator access and the selected duration.
   * 2. Replace the single global setting and show the result.
   */
  const save = async (event) => {
    event.preventDefault();
    setError('');
    setSaved(false);
    // STEP 1: The global setting is available only to the administrator.
    if (auth.currentUser?.email?.toLowerCase() !== 'admin@saba321.com' || !Number.isInteger(days) || days < 0 || days > 30) {
      setError('تعذر حفظ المهلة. تحقق من صلاحية المدير والمدة المختارة.');
      return;
    }
    setSaving(true);
    try {
      // STEP 2: A changed rule starts with today's date; older reports stay outside its scope.
      await setDoc(doc(db, 'settings', SETTING_ID), {
        enabled: true,
        graceDays: days,
        effectiveFrom: getZonedDateTime().date,
        updatedAt: serverTimestamp(),
      });
      setSaved(true);
    } catch (saveError) {
      console.error('Unable to save daily inventory deadline:', saveError);
      setError('تعذر حفظ المهلة. حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  };

  // STEP 3: Explain how the selected duration applies to all branches.
  return <div className="card daily-inventory-constraint" role="region" aria-label="قيود طلبيات وجرد">
    <h2>قيود طلبيات وجرد</h2>
    <form onSubmit={save}>
      <div className="daily-inventory-fields">
        <label>نوع الطلبية
          <select className="input-field" defaultValue="daily_inventory">
            <option value="daily_inventory">طلبية الجرد اليومي</option>
          </select>
        </label>
        <label>المهلة بعد تاريخ الطلبية
          <select className="input-field" value={graceDays} onChange={(event) => { setGraceDays(event.target.value); setSaved(false); }} disabled={loading || saving}>
            {options.map((value) => <option key={value} value={value}>{value === 0 ? 'بدون يوم إضافي' : `${value} ${value === 1 ? 'يوم' : 'أيام'}`}</option>)}
          </select>
        </label>
      </div>
      <p>تنطبق المهلة على جميع الفروع. تُقبل الطلبية حتى نهاية آخر يوم في المهلة بتوقيت الرياض، ويُحظر الفرع من اليوم التالي إذا لم يُدخلها.</p>
      <p>مثال: طلبية بتاريخ 2026-11-15 تُقبل حتى نهاية {exampleLastDay}؛ يبدأ الحظر في {exampleBanDay} إذا لم تُدخل.</p>
      {rule?.enabled && <p role="status">المهلة الحالية: {rule.graceDays === 0 ? 'بدون يوم إضافي' : `${rule.graceDays} ${rule.graceDays === 1 ? 'يوم' : 'أيام'}`} لجميع الفروع. يبدأ احتسابها من {rule.effectiveFrom}.</p>}
      {error && <p role="alert" className="daily-inventory-error">{error}</p>}
      {saved && <p role="status" className="daily-inventory-success">تم حفظ المهلة لجميع الفروع.</p>}
      <button type="submit" className="btn btn-primary" disabled={loading || saving}>{saving ? 'جارٍ الحفظ...' : 'حفظ المهلة'}</button>
    </form>
  </div>;
}
