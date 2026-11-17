import { useState } from 'react';
import { auth } from '../../config/firebase';
import { changeInventoryProductAnswer, deleteDuplicateInventoryRecord, transferInventoryDifference } from './surveyService';
import { canTransferInventoryDifference } from './inventoryTransferMath';

const duplicateRecordTime = (millis) => millis
  ? new Intl.DateTimeFormat('ar-SA', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(millis))
  : 'غير مسجل';

const InventoryResponseModal = ({ response, branch, onClose, onUpdated }) => {
  const [editingId, setEditingId] = useState('');
  const [actual, setActual] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const entries = Object.entries(response.inventoryAnswers || {});
  const [selectedIds, setSelectedIds] = useState([]);
  const [transferRun, setTransferRun] = useState(null);
  const [duplicateCase, setDuplicateCase] = useState(null);
  const [duplicateMessage, setDuplicateMessage] = useState('');
  const [duplicateMessageError, setDuplicateMessageError] = useState(false);
  const [deletingDuplicateId, setDeletingDuplicateId] = useState('');
  const transferableIds = entries.filter(([, answer]) => canTransferInventoryDifference(answer))
    .map(([productId]) => productId);
  const selectedTransferable = selectedIds.filter((id) => transferableIds.includes(id));

  /**
   * Transfers selected answers one at a time so each item has an independent result.
   * 1. Freeze the selected product IDs and show the current item.
   * 2. Save each product adjustment and refresh the response after success.
   * 3. Retain failed products for retry and show the overall outcome.
   */
  const transferSelected = async () => {
    // STEP 1: Only currently outstanding answers are included in this run.
    const ids = [...selectedTransferable];
    if (!ids.length || busy || editingId) return;
    setBusy(true);
    setError('');
    setTransferRun({ total: ids.length, finished: 0, succeeded: 0, statuses: {}, done: false });
    let currentResponse = response;
    let succeeded = 0;
    let firstDuplicate = null;
    for (const [index, productId] of ids.entries()) {
      setTransferRun((current) => ({ ...current, statuses: { ...current.statuses, [productId]: { state: 'working' } } }));
      try {
        // STEP 2: Each atomic transaction settles one product; later products use the refreshed response.
        const { inventoryAnswers, targetDate } = await transferInventoryDifference({
          responseId: response.id, productId,
          expectedDifference: currentResponse.inventoryAnswers[productId].difference,
          userId: auth.currentUser?.uid || null,
        });
        currentResponse = { ...currentResponse, inventoryAnswers };
        onUpdated(currentResponse, '');
        setSelectedIds((current) => current.filter((id) => id !== productId));
        succeeded += 1;
        setTransferRun((current) => ({
          ...current, finished: index + 1, succeeded,
          statuses: { ...current.statuses, [productId]: { state: 'success', targetDate } },
        }));
      } catch (transferError) {
        // STEP 3: Leave this difference intact and continue with other selected products.
        if (transferError.duplicateInventory && !firstDuplicate) firstDuplicate = transferError.duplicateInventory;
        setTransferRun((current) => ({
          ...current, finished: index + 1,
          statuses: { ...current.statuses, [productId]: {
            state: 'failed', message: transferError.message || 'تعذر ترحيل الصنف.',
            duplicateInventory: transferError.duplicateInventory || null,
          } },
        }));
      }
    }
    setTransferRun((current) => ({ ...current, done: true }));
    setBusy(false);
    if (firstDuplicate) {
      setDuplicateCase(firstDuplicate);
      setDuplicateMessage('');
      setDuplicateMessageError(false);
    }
  };

  /**
   * Removes one chosen duplicate without deleting the final record in its group.
   * 1. Confirm the document identity and choose another record to retain.
   * 2. Delete through the scoped service transaction.
   * 3. Refresh the duplicate list and leave the item ready for a new transfer attempt.
   */
  const removeDuplicate = async (group, record) => {
    // STEP 1: The user chooses the exact document after reviewing its displayed values.
    const keeper = group.records.find((item) => item.id !== record.id);
    if (!keeper || !duplicateCase || !window.confirm(`حذف السجل ${record.id}؟ سيبقى السجل ${keeper.id}، وستُحفظ نسخة من المحذوف في سجل التعديلات.`)) return;
    setBusy(true);
    setDeletingDuplicateId(record.id);
    setDuplicateMessage('');
    setDuplicateMessageError(false);
    try {
      // STEP 2: The service rechecks the latest day, duplicate count, and surviving record.
      await deleteDuplicateInventoryRecord({
        responseId: response.id, productId: duplicateCase.productId,
        targetDate: duplicateCase.targetDate, collectionName: group.collectionName,
        documentId: record.id, keeperId: keeper.id, userId: auth.currentUser?.uid || null,
      });
      // STEP 3: Removing the final duplicate group makes the item eligible for a fresh check.
      setDuplicateCase((current) => ({ ...current, groups: current.groups.map((item) => item.collectionName === group.collectionName
        ? { ...item, records: item.records.filter((entry) => entry.id !== record.id) } : item)
        .filter((item) => item.records.length > 1) }));
      setTransferRun((current) => current ? ({ ...current, statuses: Object.fromEntries(
        Object.entries(current.statuses).map(([id, status]) => [id, status.duplicateInventory
          ? { state: 'failed', message: 'تغيرت السجلات المكررة. أعد محاولة ترحيل الصنف.' } : status])
      ) }) : current);
      setDuplicateMessage('تم حذف السجل المحدد وحفظ نسخة في سجل التعديلات. أعد محاولة ترحيل الصنف بعد إغلاق النافذة.');
    } catch (deleteError) {
      setDuplicateMessage(deleteError.message || 'تعذر حذف السجل المكرر.');
      setDuplicateMessageError(true);
    } finally {
      setDeletingDuplicateId('');
      setBusy(false);
    }
  };

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
      onUpdated({ ...response, inventoryAnswers }, 'تم تحديث إجابة الصنف وحفظ سجل التعديل.');
      setEditingId('');
    } catch (changeError) {
      setError(changeError.message || 'تعذر تعديل إجابة الصنف.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="survey-modal-backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}>
    <section className="survey-modal survey-response-details" role="dialog" aria-modal="true" aria-label="إجابات جرد الأصناف" onMouseDown={(event) => event.stopPropagation()}>
      <div className="survey-modal-header"><div><h2>إجابات جرد الأصناف</h2><p>{branch.name || branch.id} · {response.occurrenceDate || response.month}</p></div><button type="button" className="survey-close" disabled={busy} onClick={onClose}>×</button></div>
      <div className="survey-transfer-toolbar">
        <label className="survey-inline-check"><input type="checkbox" disabled={busy || !transferableIds.length}
          checked={transferableIds.length > 0 && transferableIds.every((id) => selectedTransferable.includes(id))}
          onChange={(event) => setSelectedIds(event.target.checked ? transferableIds : [])} />تحديد الكل / إلغاء تحديد الكل</label>
        <span>المحدد: {selectedTransferable.length}</span>
        <button type="button" className="btn btn-primary" disabled={busy || !!editingId || !selectedTransferable.length} onClick={transferSelected}>ترحيل المحدد إلى آخر يوم جرد</button>
      </div>
      {transferRun && <div className={transferRun.done && transferRun.succeeded === transferRun.total ? 'survey-success' : 'survey-transfer-progress'} role="status" aria-live="polite">
        {transferRun.done ? transferRun.succeeded === transferRun.total ? 'اكتمل ترحيل جميع الأصناف المحددة.' : 'اكتملت المحاولة؛ راجع الأصناف التي تعذر ترحيلها.' : 'جارٍ ترحيل الأصناف...'}
        {' '}{transferRun.finished} من {transferRun.total}، نجح {transferRun.succeeded}
        <progress value={transferRun.finished} max={transferRun.total} aria-label="تقدم ترحيل الأصناف" />
      </div>}
      <div className="survey-table-wrap"><table className="survey-monitor-table"><thead><tr><th>تحديد</th><th>الصنف</th><th>رصيد الجرد</th><th>الموجود الفعلي</th><th>الفارق</th><th>الفائض المضاف للجرد</th><th>السبب</th><th>تاريخ الجرد</th><th>الترحيل</th><th>الإجراء</th></tr></thead><tbody>
        {entries.map(([productId, answer]) => <tr key={productId}>
          <td><input type="checkbox" aria-label={`تحديد ${answer.productName}`} disabled={busy || !transferableIds.includes(productId)}
            checked={selectedTransferable.includes(productId)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, productId] : current.filter((id) => id !== productId))} /></td>
          <td>{answer.productName}</td><td>{answer.expectedQuantity}</td>
          <td>{editingId === productId ? <input className="input-field" type="number" min="0" step="any" value={actual} onChange={(event) => setActual(event.target.value)} /> : answer.actualQuantity ?? '—'}</td>
          <td>{editingId === productId && actual !== '' ? Number(actual) - Number(answer.expectedQuantity) - Number(answer.settledDifference ?? answer.appliedSurplus ?? 0) : answer.difference ?? '—'}</td><td>{answer.appliedSurplus ?? 0}</td>
          <td>{editingId === productId ? Number(actual) - Number(answer.expectedQuantity) - Number(answer.settledDifference ?? answer.appliedSurplus ?? 0) !== 0 && <input className="input-field" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={Number(actual) - Number(answer.expectedQuantity) - Number(answer.settledDifference ?? answer.appliedSurplus ?? 0) < 0 ? 'سبب النقص' : 'سبب الزيادة'} /> : answer.reason || '—'}</td>
          <td>{answer.referenceDate || '—'}</td>
          <td>{transferRun?.statuses[productId]?.state === 'working' ? 'جارٍ الترحيل...' :
            transferRun?.statuses[productId]?.state === 'success' ? `اكتمل · ${transferRun.statuses[productId].targetDate}` :
            transferRun?.statuses[productId]?.state === 'failed' ? <span className="survey-transfer-failed">تعذر: {transferRun.statuses[productId].message}
              {transferRun.statuses[productId].duplicateInventory && <button type="button" className="survey-text-button" onClick={() => {
                setDuplicateCase(transferRun.statuses[productId].duplicateInventory); setDuplicateMessage(''); setDuplicateMessageError(false);
              }}>عرض السجلات المكررة</button>}</span> :
            answer.settledAt && Number(answer.difference) === 0 ? `تم الترحيل · ${answer.settledOnDate || ''}` :
            Number(answer.difference) > 0 && answer.settledDifference === undefined &&
              Number(answer.difference) === Number(answer.appliedSurplus || 0) ? 'أضيف الفائض للجرد عند الإرسال' : '—'}</td>
          <td>{editingId === productId ? <><button type="button" className="btn btn-primary" disabled={busy || actual === ''} onClick={() => applyChange(productId)}>حفظ</button><button type="button" className="btn survey-secondary" disabled={busy} onClick={() => setEditingId('')}>إلغاء</button></> : <><button type="button" className="btn survey-secondary" disabled={busy} onClick={() => { setEditingId(productId); setActual(String(answer.actualQuantity ?? '')); setReason(answer.reason || ''); }}>تعديل</button><button type="button" className="btn survey-danger" disabled={busy} onClick={() => applyChange(productId, true)}>حذف</button></>}</td>
        </tr>)}
      </tbody></table>{!entries.length && <p>لا توجد إجابات أصناف لهذا الفرع.</p>}</div>
      {error && <p className="survey-error">{error}</p>}
      {duplicateCase && <div className="survey-duplicate-backdrop" role="presentation">
        <section className="survey-duplicate-dialog" role="dialog" aria-modal="true" aria-label="السجلات المكررة">
          <div className="survey-modal-header"><div><h3>سجلات مكررة: {duplicateCase.productName}</h3><p>{branch.name || branch.id} · آخر يوم جرد {duplicateCase.targetDate}</p></div>
            <button type="button" className="survey-close" disabled={busy} onClick={() => setDuplicateCase(null)}>×</button></div>
          <p>راجع المعرف والرصيد والتوقيت قبل اختيار السجل المراد حذفه. لا يمكن حذف آخر سجل من كل مجموعة.</p>
          {duplicateCase.groups.map((group) => <div className="survey-duplicate-group" key={group.collectionName}>
            <h4>{group.title} ({group.records.length})</h4>
            {group.records.map((record) => <div className="survey-duplicate-record" key={record.id}>
              <div><strong>المعرف: {record.id}</strong>
                {record.closeStock != null && <span>الرصيد الختامي: {record.closeStock}</span>}
                {record.openingStockQnt != null && <span>الرصيد الافتتاحي الحالي: {record.openingStockQnt}</span>}
                {record.add != null && <span>الجرد: {record.add}</span>}
                <span>الإنشاء: {duplicateRecordTime(record.createdAt)} · آخر تعديل: {duplicateRecordTime(record.updatedAt)}</span>
                {record.matchesSummary && <small>{group.collectionName === 'dailyReportsUpdates'
                  ? 'أحدث علامة تحديث في المجموعة' : 'مطابق لرصيد الملخص المحفوظ'}</small>}
              </div>
              <button type="button" className="btn survey-danger" disabled={busy || group.records.length <= 1}
                onClick={() => removeDuplicate(group, record)}>{deletingDuplicateId === record.id ? 'جارٍ الحذف...' : 'حذف السجل'}</button>
            </div>)}
          </div>)}
          {duplicateMessage && <p className={duplicateMessageError ? 'survey-error' : 'survey-success'} role="status">{duplicateMessage}</p>}
          {!duplicateCase.groups.length && <button type="button" className="btn btn-primary" onClick={() => setDuplicateCase(null)}>إغلاق وإعادة المحاولة</button>}
        </section>
      </div>}
    </section>
  </div>;
};

export default InventoryResponseModal;
