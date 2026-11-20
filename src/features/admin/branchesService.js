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

export const DAILY_INVENTORY_COLUMNS = [
  { id: 'openingStockQnt', label: 'الموجودة' }, { id: 'recieved', label: 'المستلم' },
  { id: 'add', label: 'الجرد' }, { id: 'sales', label: 'المبيعات' },
  { id: 'staffMeal', label: 'وجبة موظف' }, { id: 'freeIncrease', label: 'تعويض زبون' },
  { id: 'canceled', label: 'مكنسل' }, { id: 'directTransfer', label: 'تحويل مباشر' },
  { id: 'transfer', label: 'تحويل' }, { id: 'dameged', label: 'التالف' },
  { id: 'closeStock', label: 'المتبقي' },
];

/** Reads current choices while preserving older opening and closing settings. */
export const getHiddenDailyInventoryColumns = (branch) => {
  if (Array.isArray(branch.dailyInventoryHiddenColumns)) {
    return branch.dailyInventoryHiddenColumns.filter((id) => DAILY_INVENTORY_COLUMNS.some((column) => column.id === id));
  }
  const legacyHidden = branch.hideDailyStockColumns === true;
  const openingHidden = typeof branch.hideOpeningStockColumn === 'boolean'
    ? branch.hideOpeningStockColumn : legacyHidden;
  const closingHidden = typeof branch.hideClosingStockColumn === 'boolean'
    ? branch.hideClosingStockColumn : legacyHidden;
  return [openingHidden && 'openingStockQnt', closingHidden && 'closeStock'].filter(Boolean);
};

export const getBranchStockVisibility = (branch) => {
  const hidden = getHiddenDailyInventoryColumns(branch);
  return hidden.includes('openingStockQnt') && hidden.includes('closeStock');
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
export const saveBranchStockVisibility = async (branches, selectedIds, columnChoices) => {
  // STEP 1: Only explicitly selected active branch IDs may be changed.
  assertAdmin();
  if (!Array.isArray(branches) || !Array.isArray(selectedIds) || !columnChoices ||
      Object.entries(columnChoices).some(([id, hidden]) => !DAILY_INVENTORY_COLUMNS.some((column) => column.id === id) || typeof hidden !== 'boolean')) {
    throw new Error('بيانات الفروع غير صحيحة. حدّث الصفحة.');
  }
  const activeIds = new Set(branches.filter((branch) => branch.status !== 'archived').map((branch) => branch.id));
  const ids = [...new Set(selectedIds)];
  if (!ids.length) throw new Error('حدد فرعًا واحدًا على الأقل.');
  ids.forEach((id) => {
    assertBranchId(id);
    if (!activeIds.has(id)) throw new Error('أحد الفروع المحددة لم يعد نشطًا. حدّث الصفحة.');
  });

  // STEP 2: Merge only changed columns with each branch's current preferences.
  for (let start = 0; start < ids.length; start += 450) {
    const batch = writeBatch(db);
    ids.slice(start, start + 450).forEach((id) => {
      const branch = branches.find((item) => item.id === id);
      const hidden = new Set(getHiddenDailyInventoryColumns(branch));
      Object.entries(columnChoices).forEach(([columnId, hide]) => {
        if (hide) hidden.add(columnId); else hidden.delete(columnId);
      });
      const openingHidden = hidden.has('openingStockQnt');
      const closingHidden = hidden.has('closeStock');
      batch.update(doc(db, 'branches', id), {
        dailyInventoryHiddenColumns: [...hidden],
        hideOpeningStockColumn: openingHidden,
        hideClosingStockColumn: closingHidden,
        hideDailyStockColumns: openingHidden && closingHidden,
      });
    });
    await batch.commit();
  }
  return ids.length;
};
