import { collection, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth, db } from '../../config/firebase';

const manageBranch = httpsCallable(getFunctions(auth.app, 'asia-east1'), 'manageBranch');

export const loadBranches = async () => {
  const snapshot = await getDocs(collection(db, 'branches'));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    .sort((left, right) => (left.name || '').localeCompare(right.name || '', 'ar'));
};

/**
 * Sends an administrator's branch change to the trusted account manager.
 * 1. Validate the fields needed for this action before the request.
 * 2. Let the server create or disable the Firebase Auth account with the branch record.
 */
export const saveBranchChange = async (action, values) => {
  // STEP 1: Reject malformed input before making a remote request.
  const name = String(values.name || '').trim();
  if (action !== 'delete' && (!name || !['ryad', 'other'].includes(values.city))) {
    throw new Error('أدخل اسم الفرع وحدد المدينة.');
  }
  if (action === 'create' && String(values.password || '').length < 8) {
    throw new Error('اكتب كلمة مرور من 8 أحرف على الأقل.');
  }
  if (action !== 'create' && !values.id) throw new Error('معرّف الفرع مفقود. حدّث الصفحة.');
  // STEP 2: Account changes stay on the server; the browser never receives Admin SDK credentials.
  const result = await manageBranch({ action, id: values.id, name,
    city: values.city, password: action === 'create' ? values.password : undefined });
  return result.data;
};
