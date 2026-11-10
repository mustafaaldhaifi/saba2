import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';

const assertAdmin = () => {
  if (auth.currentUser?.email?.toLowerCase() !== 'admin@saba321.com') {
    throw new Error('هذا الإعداد متاح للإدارة فقط.');
  }
};

const assertBranchId = (branchId) => {
  if (typeof branchId !== 'string' || !branchId || branchId.includes('/')) {
    throw new Error('معرّف الفرع غير صحيح. حدّث الصفحة.');
  }
};

/** Treats an older separate-column setting as hidden only when both columns were hidden. */
export const getBranchStockVisibility = (branch) => {
  const legacyHidden = branch.hideDailyStockColumns === true;
  const openingHidden = typeof branch.hideOpeningStockColumn === 'boolean'
    ? branch.hideOpeningStockColumn : legacyHidden;
  const closingHidden = typeof branch.hideClosingStockColumn === 'boolean'
    ? branch.hideClosingStockColumn : legacyHidden;
  return openingHidden && closingHidden;
};

export const loadBranches = async () => {
  const snapshot = await getDocs(collection(db, 'branches'));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    .sort((left, right) => (left.name || '').localeCompare(right.name || '', 'ar'));
};

/**
 * Applies one shared hide/show choice to selected active branches.
 * 1. Validate the selected IDs against the loaded active branches.
 * 2. Update existing branch documents in batches below Firestore's limit.
 */
export const saveBranchStockVisibility = async (branches, selectedIds, hidden) => {
  // STEP 1: Only explicitly selected active branch IDs may be changed.
  assertAdmin();
  if (!Array.isArray(branches) || !Array.isArray(selectedIds) || typeof hidden !== 'boolean') {
    throw new Error('بيانات الفروع غير صحيحة. حدّث الصفحة.');
  }
  const activeIds = new Set(branches.filter((branch) => branch.status !== 'archived').map((branch) => branch.id));
  const ids = [...new Set(selectedIds)];
  if (!ids.length) throw new Error('حدد فرعًا واحدًا على الأقل.');
  ids.forEach((id) => {
    assertBranchId(id);
    if (!activeIds.has(id)) throw new Error('أحد الفروع المحددة لم يعد نشطًا. حدّث الصفحة.');
  });

  // STEP 2: Keep the legacy and newer fields aligned for already deployed clients.
  const update = {
    hideDailyStockColumns: hidden,
    hideOpeningStockColumn: hidden,
    hideClosingStockColumn: hidden,
  };
  for (let start = 0; start < ids.length; start += 450) {
    const batch = writeBatch(db);
    ids.slice(start, start + 450).forEach((id) => {
      batch.update(doc(db, 'branches', id), update);
    });
    await batch.commit();
  }
  return ids.length;
};
