import { collection, doc, getDocs, query, runTransaction, serverTimestamp, Timestamp, where } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';

const ADMIN_BAN_ITEM_ID = 'administrative';

const assertAdmin = () => {
  if (auth.currentUser?.email?.toLowerCase() !== 'admin@saba321.com') {
    throw new Error('إدارة الحظر متاحة للإدارة فقط.');
  }
};

/**
 * Applies an administrative ban and records its cause in one Firestore transaction.
 * 1. Validate the administrator, branch, and message.
 * 2. Cancel an active attempt, then update the branch and append history.
 */
export const banBranch = async (branchId, message) => {
  // STEP 1: Reject invalid requests before opening a transaction.
  assertAdmin();
  const cleanMessage = typeof message === 'string' ? message.trim() : '';
  if (!branchId || branchId.includes('/') || !cleanMessage) throw new Error('اختر فرعًا واكتب سبب الحظر.');
  const branchRef = doc(db, 'branches', branchId);
  const itemRef = doc(db, 'banItems', ADMIN_BAN_ITEM_ID);
  const historyRef = doc(collection(db, 'bansHistory'));
  const attemptRef = doc(db, 'banAttempts', branchId);

  // STEP 2: Keep the current status and the historical event consistent.
  await runTransaction(db, async (transaction) => {
    const [branch, item, attempt] = await Promise.all([transaction.get(branchRef), transaction.get(itemRef), transaction.get(attemptRef)]);
    if (!branch.exists() || branch.data().status === 'archived') throw new Error('الفرع غير متاح. حدّث الصفحة.');
    if (attempt.data()?.status === 'active') transaction.update(attemptRef, { status: 'cancelled', closedAt: serverTimestamp() });
    if (!item.exists()) transaction.set(itemRef, { type: 'administrative', title: 'حظر إداري' });
    transaction.update(branchRef, { ban: cleanMessage });
    transaction.set(historyRef, {
      branchId,
      banItemId: ADMIN_BAN_ITEM_ID,
      message: cleanMessage,
      bannedAt: serverTimestamp(),
    });
  });
};

/**
 * Clears the current branch ban while retaining its historical records.
 * 1. Verify the administrator and read the branch.
 * 2. Cancel active general and legacy grants, then clear the ban without changing bansHistory.
 */
export const unbanBranch = async (branchId) => {
  // STEP 1: Only the administrator may clear an existing branch ban.
  assertAdmin();
  if (!branchId || branchId.includes('/')) throw new Error('معرّف الفرع غير صحيح.');
  const branchRef = doc(db, 'branches', branchId);
  const attemptRef = doc(db, 'banAttempts', branchId);
  const legacyGrants = await getDocs(query(collection(db, 'surveyAccessOverrides'), where('branchId', '==', branchId)));
  // STEP 2: Preserve historical ban records after the current status changes.
  await runTransaction(db, async (transaction) => {
    const [branch, attempt, ...grants] = await Promise.all([
      transaction.get(branchRef), transaction.get(attemptRef),
      ...legacyGrants.docs.map((item) => transaction.get(item.ref)),
    ]);
    if (!branch.exists() || branch.data().status === 'archived') throw new Error('الفرع غير متاح. حدّث الصفحة.');
    if (attempt.data()?.status === 'active') transaction.update(attemptRef, { status: 'cancelled', closedAt: serverTimestamp() });
    grants.forEach((grant) => {
      if (grant.exists() && !grant.data().cancelledAt) transaction.update(grant.ref, { cancelledAt: serverTimestamp() });
    });
    transaction.update(branchRef, { ban: null });
  });
};

export const loadBanAttempts = async () => {
  const snapshot = await getDocs(collection(db, 'banAttempts'));
  return Object.fromEntries(snapshot.docs.map((item) => [item.id, item.data()]));
};

/**
 * Grants one time-limited attempt for the branch's current ban event.
 * 1. Locate the latest historical event matching the branch's current message.
 * 2. Save the attempt and clear the ban in one transaction.
 */
export const grantBanAttempt = async (branchId, expiresAt) => {
  // STEP 1: An attempt must reference a real, currently active ban.
  assertAdmin();
  if (!branchId || branchId.includes('/') || !(expiresAt instanceof Date) ||
      Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
    throw new Error('اختر وقت انتهاء صالحًا للمحاولة.');
  }
  const branchRef = doc(db, 'branches', branchId);
  const branchHistory = await getDocs(query(collection(db, 'bansHistory'), where('branchId', '==', branchId)));
  const events = branchHistory.docs.sort((left, right) => (right.data().bannedAt?.toMillis?.() || 0) -
    (left.data().bannedAt?.toMillis?.() || 0));
  const attemptRef = doc(db, 'banAttempts', branchId);
  // STEP 2: Recheck the branch inside the transaction before granting access.
  await runTransaction(db, async (transaction) => {
    const branch = await transaction.get(branchRef);
    if (!branch.exists() || branch.data().status === 'archived' || typeof branch.data().ban !== 'string') {
      throw new Error('الفرع غير محظور حاليًا. حدّث الصفحة.');
    }
    const source = events.find((item) => item.data().message === branch.data().ban);
    if (!source) throw new Error('تعذر العثور على سجل الحظر الحالي لهذا الفرع.');
    transaction.set(attemptRef, {
      sourceBanId: source.id,
      expiresAt: Timestamp.fromDate(expiresAt),
      status: 'active',
      grantedAt: serverTimestamp(),
      grantedBy: auth.currentUser.uid,
      closedAt: null,
    });
    transaction.update(branchRef, { ban: null });
  });
};

/**
 * Initializes the current-ban field on older branch documents.
 * 1. Select documents that have no ban field in the loaded directory.
 * 2. Recheck each document before writing null so a concurrent ban is preserved.
 */
export const initializeBranchBans = async (branches) => {
  // STEP 1: Only older documents without a stored ban need migration.
  assertAdmin();
  const missing = branches.filter((branch) => !Object.hasOwn(branch, 'ban'));
  // STEP 2: Re-read within each transaction before setting the initial value.
  for (const branch of missing) {
    const branchRef = doc(db, 'branches', branch.id);
    await runTransaction(db, async (transaction) => {
      const current = await transaction.get(branchRef);
      if (current.exists() && !Object.hasOwn(current.data(), 'ban')) {
        transaction.update(branchRef, { ban: null });
      }
    });
  }
};
