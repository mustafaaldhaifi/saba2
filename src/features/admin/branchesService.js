import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';

export const loadBranches = async () => {
  const snapshot = await getDocs(collection(db, 'branches'));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    .sort((left, right) => (left.name || '').localeCompare(right.name || '', 'ar'));
};

/**
 * Saves only the daily stock column preference on an existing branch.
 * 1. Reject missing branch identity and non-admin sessions before writing.
 * 2. Update the one preference field without replacing other branch data.
 */
export const saveBranchStockVisibility = async (branchId, hidden) => {
  // STEP 1: Prevent accidental writes outside the selected branch and admin page.
  if (auth.currentUser?.email?.toLowerCase() !== 'admin@saba321.com') throw new Error('هذا الإعداد متاح للإدارة فقط.');
  if (typeof branchId !== 'string' || !branchId || branchId.includes('/')) throw new Error('معرّف الفرع غير صحيح. حدّث الصفحة.');

  // STEP 2: Firestore rules provide the server-side permission check.
  await updateDoc(doc(db, 'branches', branchId), { hideDailyStockColumns: hidden === true });
};
