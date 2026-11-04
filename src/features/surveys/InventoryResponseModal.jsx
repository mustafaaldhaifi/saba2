import { useState } from 'react';
import { auth } from '../../config/firebase';
import { changeInventoryProductAnswer } from './surveyService';

const InventoryResponseModal = ({ response, branch, onClose, onUpdated }) => {
  const [editingId, setEditingId] = useState('');
  const [actual, setActual] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const entries = Object.entries(response.inventoryAnswers || {});

  /**
   * Applies one product correction or deletion.
   * 1. Confirm a deletion when requested.
   * 2. Save the scoped change and audit record.
   * 3. Replace the response in the parent view.
   */
  const applyChange = async (productId, remove = false) => {
    // STEP 1: Confirm removal of this product answer only.
    if (remove && !window.confirm('حذف إجابة هذا الصنف لهذا الفرع؟')) return;
    try {
      setBusy(true);
      setError('');
      // STEP 2: Save and record the change atomically.
      const inventoryAnswers = await changeInventoryProductAnswer({
        responseId: response.id, productId, actualQuantity: actual, reason,
        remove, userId: auth.currentUser?.uid || null,
      });
      // STEP 3: Show the updated answer without another collection read.
      onUpdated({ ...response, inventoryAnswers });
      setEditingId('');
    } catch (changeError) {
      setError(changeError.message || 'تعذر تعديل إجابة الصنف.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="survey-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="survey-modal survey-response-details" role="dialog" aria-modal="true" aria-label="إجابات جرد الأصناف" onMouseDown={(event) => event.stopPropagation()}>
      <div className="survey-modal-header"><div><h2>إجابات جرد الأصناف</h2><p>{branch.name || branch.id} · {response.occurrenceDate || response.month}</p></div><button type="button" className="survey-close" onClick={onClose}>×</button></div>
      <div className="survey-table-wrap"><table className="survey-monitor-table"><thead><tr><th>الصنف</th><th>رصيد الجرد</th><th>الموجود الفعلي</th><th>الفارق</th><th>الفائض المضاف للجرد</th><th>السبب</th><th>تاريخ الجرد</th><th>الإجراء</th></tr></thead><tbody>
        {entries.map(([productId, answer]) => <tr key={productId}>
          <td>{answer.productName}</td><td>{answer.expectedQuantity}</td>
          <td>{editingId === productId ? <input className="input-field" type="number" min="0" step="any" value={actual} onChange={(event) => setActual(event.target.value)} /> : answer.actualQuantity ?? '—'}</td>
          <td>{editingId === productId && actual !== '' ? Number(actual) - Number(answer.expectedQuantity) : answer.difference ?? '—'}</td><td>{answer.appliedSurplus ?? 0}</td>
          <td>{editingId === productId ? Number(actual) !== Number(answer.expectedQuantity) && <input className="input-field" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={Number(actual) < Number(answer.expectedQuantity) ? 'سبب النقص' : 'سبب الزيادة'} /> : answer.reason || '—'}</td>
          <td>{answer.referenceDate || '—'}</td>
          <td>{editingId === productId ? <><button type="button" className="btn btn-primary" disabled={busy || actual === ''} onClick={() => applyChange(productId)}>حفظ</button><button type="button" className="btn survey-secondary" disabled={busy} onClick={() => setEditingId('')}>إلغاء</button></> : <><button type="button" className="btn survey-secondary" disabled={busy} onClick={() => { setEditingId(productId); setActual(String(answer.actualQuantity ?? '')); setReason(answer.reason || ''); }}>تعديل</button><button type="button" className="btn survey-danger" disabled={busy} onClick={() => applyChange(productId, true)}>حذف</button></>}</td>
        </tr>)}
      </tbody></table>{!entries.length && <p>لا توجد إجابات أصناف لهذا الفرع.</p>}</div>
      {error && <p className="survey-error">{error}</p>}
    </section>
  </div>;
};

export default InventoryResponseModal;
