const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { createHash } = require('node:crypto');

initializeApp();

const ADMIN_UID = 'z8B2PHGNnaRIRCqEsvesvE5IeAL2';
const DOMAIN = 'saba321.com';

const cleanName = (value) => {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 2 || name.length > 80 || /[\x00-\x1f]/.test(name)) {
    throw new HttpsError('invalid-argument', 'أدخل اسم فرع صحيحًا من 2 إلى 80 حرفًا.');
  }
  return name;
};

const cleanCity = (value) => {
  if (!['ryad', 'other'].includes(value)) throw new HttpsError('invalid-argument', 'اختر مدينة صحيحة.');
  return value;
};

const cleanLoginName = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value) || value.length > 40) {
    throw new HttpsError('invalid-argument', 'رمز الدخول يجب أن يكون بحروف إنجليزية، وبحد أقصى 40 حرفًا.');
  }
  if (value.toLowerCase() === 'admin') throw new HttpsError('already-exists', 'رمز دخول الإدارة محجوز.');
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
};

/**
 * Creates a stable ASCII login key from a branch's display name.
 * 1. Fold Latin accents and turn separators into hyphens.
 * 2. Add a name hash for other scripts, long names, or reserved keys.
 */
const loginNameFromBranchName = (name) => {
  // STEP 1: Keep familiar Latin branch names aligned with their email prefix.
  const folded = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const slug = folded.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  // STEP 2: A hash keeps Arabic, mixed-script, and truncated names distinct.
  const needsHash = !slug || !/^[a-z]/.test(slug) || slug === 'admin' ||
    slug.length > 40 || /[^\x00-\x7F]/.test(folded);
  const hash = createHash('sha256').update(name.normalize('NFKC')).digest('hex').slice(0, 12);
  const key = needsHash ? `${/^[a-z]/.test(slug) ? slug.slice(0, 26) : 'branch'}-${hash}` : slug.slice(0, 40);
  return cleanLoginName(key);
};

/**
 * Rejects a branch name or login key already held by another branch.
 * 1. Read the small branch directory from Firestore.
 * 2. Compare normalized names and immutable login keys.
 */
const assertUniqueBranch = async (database, name, loginName, exceptId = '') => {
  // STEP 1: Read the current directory before an Auth account is created.
  const snapshot = await database.collection('branches').get();
  // STEP 2: Existing legacy names also reserve their login keys.
  const duplicate = snapshot.docs.some((item) => item.id !== exceptId && (
    String(item.data().name || '').toLocaleLowerCase() === name.toLocaleLowerCase() ||
    String(item.data().loginName || item.data().name || '').toLowerCase() === loginName.toLowerCase() ||
    String(item.data().loginName || item.data().name || '').toLocaleLowerCase() === name.toLocaleLowerCase() ||
    String(item.data().name || '').toLowerCase() === loginName.toLowerCase()
  ));
  if (duplicate) throw new HttpsError('already-exists', 'اسم الفرع أو رمز دخوله مستخدم بالفعل.');
};

/** Resolves a legacy account by email when the branch predates authUid storage. */
const getBranchUser = async (authentication, branch) => {
  try {
    return branch.authUid
      ? await authentication.getUser(branch.authUid)
      : await authentication.getUserByEmail(`${cleanLoginName(branch.loginName || branch.name).toLowerCase()}@${DOMAIN}`);
  } catch (error) {
    if (error.code === 'auth/user-not-found') return null;
    throw error;
  }
};

/**
 * Creates, edits, or removes one branch and its login account for the known administrator.
 * 1. Verify the caller and validate the requested action.
 * 2. Keep Auth and Firestore changes scoped to one branch.
 * 3. Archive a removed branch so every historical reference remains valid.
 */
exports.manageBranch = onCall({ region: 'asia-east1', maxInstances: 10 }, async (request) => {
  // STEP 1: Never trust the administration page alone for account privileges.
  if (request.auth?.uid !== ADMIN_UID) throw new HttpsError('permission-denied', 'هذه العملية متاحة للإدارة فقط.');
  const { action, id } = request.data || {};
  if (!['create', 'update', 'delete'].includes(action)) throw new HttpsError('invalid-argument', 'عملية غير صحيحة.');
  const database = getFirestore();
  const authentication = getAuth();

  if (action === 'create') {
    // STEP 2: Create Auth first, and roll it back if the branch document cannot be saved.
    const name = cleanName(request.data.name);
    const city = cleanCity(request.data.city);
    const loginName = loginNameFromBranchName(name);
    const password = request.data.password;
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      throw new HttpsError('invalid-argument', 'كلمة المرور يجب أن تكون بين 8 و128 حرفًا.');
    }
    await assertUniqueBranch(database, name, loginName);
    const email = `${loginName.toLowerCase()}@${DOMAIN}`;
    let user;
    try {
      user = await authentication.createUser({ email, password, displayName: name });
    } catch (error) {
      if (error.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'حساب الدخول موجود بالفعل.');
      throw error;
    }
    try {
      const reference = database.collection('branches').doc();
      await reference.set({ name, loginName, city, authUid: user.uid, status: 'active',
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      return { id: reference.id, email };
    } catch (error) {
      await authentication.deleteUser(user.uid);
      throw error;
    }
  }

  if (typeof id !== 'string' || !id || id.includes('/')) throw new HttpsError('invalid-argument', 'معرّف الفرع غير صحيح.');
  const reference = database.collection('branches').doc(id);
  const document = await reference.get();
  if (!document.exists) throw new HttpsError('not-found', 'لم يعد الفرع موجودًا. حدّث الصفحة.');
  const branch = document.data();

  if (action === 'update') {
    // STEP 2: The account key and document ID remain stable when display details change.
    const name = cleanName(request.data.name);
    const city = cleanCity(request.data.city);
    const loginName = cleanLoginName(branch.loginName || branch.name);
    await assertUniqueBranch(database, name, loginName, id);
    await reference.update({ name, loginName, city, updatedAt: FieldValue.serverTimestamp() });
    return { id };
  }

  // STEP 3: Disable login and retain the branch ID for past records and reports.
  const user = await getBranchUser(authentication, branch);
  if (user && !user.disabled) await authentication.updateUser(user.uid, { disabled: true });
  if (user) await authentication.revokeRefreshTokens(user.uid);
  await reference.update({ status: 'archived', archivedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp() });
  return { id, archived: true };
});
