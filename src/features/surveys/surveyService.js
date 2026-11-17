import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { RESPONSE_STATUS, SURVEY_STATUS } from './surveyConstants';
import { cleanSurveyAnswers, validateSurveyAnswers } from './surveyValidation';
import { getExpiredOccurrences, getLatestDueOccurrence, getResponseMonth, getScheduleForOccurrence, getSurveySchedule, getZonedDateTime, occurrenceDateOfResponse, scheduledDateTime } from './surveySchedule';
import { calculateInventoryTransfer, canTransferInventoryDifference } from './inventoryTransferMath';

const SURVEYS = 'surveys';
const RESPONSES = 'surveyResponses';
const REVISIONS = 'surveyResponseRevisions';
const ACCESS_OVERRIDES = 'surveyAccessOverrides';
const surveyCache = { value: null, expiresAt: 0 };
const responseCache = new Map();
const CACHE_MS = 60_000;

export const updateCachedSurveyResponse = (response) => {
  const cached = responseCache.get(response.surveyId);
  if (cached) cached.value = cached.value.map((item) => item.id === response.id ? response : item);
};

const responseId = (surveyId, branchId, occurrenceDate) => `${surveyId}__${branchId}__${occurrenceDate}`;
const overrideId = responseId;
const attemptMatchesSurvey = (source, surveyId, occurrenceDate) =>
  source?.banItemId === `survey_${surveyId}` && source.message?.endsWith(` بتاريخ ${occurrenceDate}`);

/**
 * Records one expired survey occurrence without reinstating an admin-cleared event.
 * 1. Read its branch, catalog item, and deterministic history record.
 * 2. Preserve an existing status or write the new ban and history together.
 */
const applyMissedSurveyBan = async (branchId, survey, occurrenceDate, eventKey = '') => {
  // STEP 1: A later expired access grant is a separate ban event.
  const itemId = `survey_${survey.id}`;
  const historyId = `${branchId}__${itemId}__${occurrenceDate}${eventKey ? `__${eventKey}` : ''}`;
  const branchRef = doc(db, 'branches', branchId);
  const itemRef = doc(db, 'banItems', itemId);
  const historyRef = doc(db, 'bansHistory', historyId);
  const message = `تأخر الاستبيان «${survey.title}» بتاريخ ${occurrenceDate}`;
  return runTransaction(db, async (transaction) => {
    const [branch, item, history] = await Promise.all([
      transaction.get(branchRef), transaction.get(itemRef), transaction.get(historyRef),
    ]);
    if (!branch.exists() || branch.data().status === 'archived') throw new Error('الفرع غير متاح.');
    const current = branch.data().ban;
    // STEP 2: A cleared historical event cannot be applied again on page refresh.
    if (typeof current === 'string') return current;
    if (history.exists()) return null;
    if (!item.exists()) transaction.set(itemRef, { type: 'survey', title: survey.title });
    transaction.update(branchRef, { ban: message });
    transaction.set(historyRef, { branchId, banItemId: itemId, message, bannedAt: serverTimestamp() });
    return message;
  });
};

export const getSurveyAccessOverrides = async (surveyId) => {
  const snapshot = await getDocs(query(collection(db, ACCESS_OVERRIDES), where('surveyId', '==', surveyId)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
};

/**
 * Reopens one expired survey occurrence for an administrator-selected period.
 * 1. Verify the administrator, target branch, expired date, and absence of submission.
 * 2. Save the scoped grant and clear its matching current survey ban.
 */
export const grantSurveyAccess = async ({ surveyId, branchId, occurrenceDate, expiresAt, userId }) => {
  // STEP 1: Reject a grant for another account, active date, or completed answer.
  if (auth.currentUser?.email?.toLowerCase() !== 'admin@saba321.com') throw new Error('فتح التقييد متاح للإدارة فقط.');
  if (!(expiresAt instanceof Date) || expiresAt <= new Date()) throw new Error('اختر موعد انتهاء جديدًا في المستقبل.');
  const surveyDocument = await getDoc(doc(db, SURVEYS, surveyId));
  if (!surveyDocument.exists() || surveyDocument.data().status !== SURVEY_STATUS.ACTIVE ||
      !surveyDocument.data().targetBranchIds?.includes(branchId) ||
      !getExpiredOccurrences(surveyDocument.data(), [], new Date()).includes(occurrenceDate)) {
    throw new Error('هذا الموعد غير متاح لفتح التقييد. حدّث الصفحة.');
  }
  if ((await getDoc(doc(db, RESPONSES, responseId(surveyId, branchId, occurrenceDate)))).data()?.status === RESPONSE_STATUS.SUBMITTED) {
    throw new Error('الفرع أرسل هذا الموعد بالفعل.');
  }
  // STEP 2: Reopen the occurrence and clear only its matching survey ban.
  const branchRef = doc(db, 'branches', branchId);
  const overrideRef = doc(db, ACCESS_OVERRIDES, overrideId(surveyId, branchId, occurrenceDate));
  const baseHistoryRef = doc(db, 'bansHistory', `${branchId}__survey_${surveyId}__${occurrenceDate}`);
  await runTransaction(db, async (transaction) => {
    const [branch, oldOverride, baseHistory] = await Promise.all([
      transaction.get(branchRef), transaction.get(overrideRef), transaction.get(baseHistoryRef),
    ]);
    if (!branch.exists() || branch.data().status === 'archived') throw new Error('الفرع غير متاح.');
    const oldExpiry = oldOverride.data()?.expiresAt?.seconds;
    const reopenedHistory = oldExpiry ? await transaction.get(doc(db, 'bansHistory',
      `${branchId}__survey_${surveyId}__${occurrenceDate}__grant_${oldExpiry}`)) : null;
    const matchingBan = [baseHistory, reopenedHistory].some((history) =>
      history?.exists() && history.data().message === branch.data().ban);
    if (typeof branch.data().ban === 'string' && !matchingBan) {
      throw new Error('يوجد حظر آخر على الفرع. أبطله من إدارة الفروع أولًا.');
    }
    if (matchingBan) transaction.update(branchRef, { ban: null });
    transaction.set(overrideRef, {
      surveyId, branchId, occurrenceDate, expiresAt: Timestamp.fromDate(expiresAt),
      grantedAt: serverTimestamp(), grantedBy: userId,
    });
  });
};

/**
 * Resolves the branch's current ban or oldest expired survey occurrence.
 * 1. Read the branch, active surveys, answers, and access grants.
 * 2. Find the earliest unanswered date after its end-of-day deadline.
 * 3. Respect an existing ban or grant, then record a new missed-survey ban once.
 */
export const getBranchSurveyRestriction = async (branchId, knownAttempt) => {
  // STEP 1: Read current documents rather than cached survey or response lists.
  const branch = await getDoc(doc(db, 'branches', branchId));
  if (!branch.exists() || branch.data().status === 'archived') throw new Error('الفرع غير متاح.');
  const currentBan = typeof branch.data().ban === 'string' ? branch.data().ban : null;
  if (currentBan) return { survey: null, occurrenceDate: null, reopened: false, banMessage: currentBan };
  const [surveys, responses, overrides] = await Promise.all([
    getDocs(query(collection(db, SURVEYS), where('status', '==', SURVEY_STATUS.ACTIVE))),
    getDocs(query(collection(db, RESPONSES), where('branchId', '==', branchId))),
    getDocs(query(collection(db, ACCESS_OVERRIDES), where('branchId', '==', branchId))),
  ]);
  const attemptData = knownAttempt === undefined
    ? (await getDoc(doc(db, 'banAttempts', branchId))).data() : knownAttempt;
  const answers = responses.docs.map((item) => ({ id: item.id, ...item.data() }));
  const grants = overrides.docs.map((item) => item.data()).filter((item) => !item.cancelledAt);
  const activeAttempt = attemptData?.status === 'active' ? attemptData : null;
  const attemptSource = activeAttempt ? await getDoc(doc(db, 'bansHistory', activeAttempt.sourceBanId)) : null;
  if (activeAttempt && activeAttempt.expiresAt?.toDate?.() <= new Date()) {
    return { survey: null, occurrenceDate: null, reopened: false,
      banMessage: attemptSource?.data()?.message || 'انتهت المحاولة الإضافية. تواصل مع الإدارة.' };
  }
  // STEP 2: A live grant opens only its named occurrence, not the branch dashboard.
  const missed = surveys.docs.flatMap((item) => {
    const survey = { id: item.id, ...item.data() };
    if (!survey.targetBranchIds?.includes(branchId) || survey.excludedBranchIds?.includes(branchId)) return [];
    return getExpiredOccurrences(survey, answers.filter((answer) => answer.surveyId === survey.id))
      .map((occurrenceDate) => ({ survey, occurrenceDate }));
  }).sort((left, right) => left.occurrenceDate.localeCompare(right.occurrenceDate));
  if (activeAttempt) {
    const attemptSurvey = missed.find((item) => attemptMatchesSurvey(attemptSource?.data(), item.survey.id, item.occurrenceDate));
    return attemptSurvey ? { ...attemptSurvey, reopened: true } : null;
  }
  if (!missed.length) return null;
  const history = await getDocs(query(collection(db, 'bansHistory'), where('branchId', '==', branchId)));
  const recordedBans = new Set(history.docs.map((item) => item.id));
  const first = missed.find((item) => {
    const grant = grants.find((entry) => entry.surveyId === item.survey.id && entry.occurrenceDate === item.occurrenceDate);
    if (grant?.expiresAt?.toDate && grant.expiresAt.toDate() > new Date()) return true;
    const eventKey = grant?.expiresAt?.seconds ? `__grant_${grant.expiresAt.seconds}` : '';
    return !recordedBans.has(`${branchId}__survey_${item.survey.id}__${item.occurrenceDate}${eventKey}`);
  });
  if (!first) return null;
  const grant = grants.find((item) => item.surveyId === first.survey.id && item.occurrenceDate === first.occurrenceDate);
  if (grant?.expiresAt?.toDate && grant.expiresAt.toDate() > new Date()) return { ...first, reopened: true };
  // STEP 3: A recorded event stays cleared until a new deadline or grant expiry.
  const eventKey = grant?.expiresAt?.seconds ? `grant_${grant.expiresAt.seconds}` : '';
  const banMessage = await applyMissedSurveyBan(branchId, first.survey, first.occurrenceDate, eventKey);
  return banMessage ? { ...first, reopened: false, banMessage } : null;
};

export const getBranches = async () => {
  const snapshot = await getDocs(collection(db, 'branches'));
  return snapshot.docs
    .map((branch) => ({ id: branch.id, ...branch.data() }))
    .sort((first, second) => (first.name || first.id).localeCompare(second.name || second.id, 'ar'));
};

export const getSurveys = async () => {
  if (surveyCache.value && Date.now() < surveyCache.expiresAt) return surveyCache.value;
  const snapshot = await getDocs(collection(db, SURVEYS));
  surveyCache.value = snapshot.docs
    .map((survey) => ({ id: survey.id, ...survey.data() }))
    .sort((first, second) => (second.createdAt?.seconds || 0) - (first.createdAt?.seconds || 0));
  surveyCache.expiresAt = Date.now() + CACHE_MS;
  return surveyCache.value;
};

/**
 * Creates a survey and its corresponding ban catalog item.
 * 1. Normalize the questions and allocate a stable survey ID.
 * 2. Save the survey and ban item in one batch.
 */
export const createSurvey = async ({ title, description, kind = 'documents', targetBranchIds, questions, schedule }) => {
  // STEP 1: Keep the ban item ID tied to the survey's permanent document ID.
  surveyCache.expiresAt = 0;
  const cleanQuestions = (kind === 'inventory' ? [] : questions).map((question) => ({
    ...question,
    label: question.label.trim(),
  }));
  const reference = doc(collection(db, SURVEYS));
  // STEP 2: A survey never becomes active without its catalog item.
  const batch = writeBatch(db);
  batch.set(reference, {
    title: title.trim(),
    description: description.trim(),
    kind,
    ...(kind === 'inventory' ? { inventory: { typeId: '5' } } : {}),
    status: SURVEY_STATUS.ACTIVE,
    startsFrom: schedule.startDate.slice(0, 7),
    schedule,
    targetBranchIds,
    excludedBranchIds: [],
    questions: cleanQuestions,
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'banItems', `survey_${reference.id}`), { type: 'survey', title: title.trim() });
  await batch.commit();
  return reference;
};

/**
 * Updates a survey and keeps its ban catalog title aligned.
 * 1. Compute the revised questions, schedule, and version.
 * 2. Save the survey and its catalog item together.
 */
export const updateSurvey = async (survey, changes) => {
  // STEP 1: Preserve the existing survey version and schedule history rules.
  surveyCache.expiresAt = 0;
  const kind = changes.kind || 'documents';
  const questions = (kind === 'inventory' ? [] : changes.questions).map((question) => ({ ...question, label: question.label.trim() }));
  const questionsChanged = JSON.stringify(questions) !== JSON.stringify(survey.questions);
  const scheduleChanged = JSON.stringify(changes.schedule) !== JSON.stringify(getSurveySchedule(survey));
  const scheduleHistory = scheduleChanged ? [
    ...(survey.scheduleHistory || []),
    { ...getSurveySchedule(survey), endDate: changes.schedule.startDate },
  ] : survey.scheduleHistory || [];
  // STEP 2: Retain the same catalog ID across survey edits.
  const batch = writeBatch(db);
  batch.update(doc(db, SURVEYS, survey.id), {
    title: changes.title.trim(),
    description: changes.description.trim(),
    kind,
    inventory: kind === 'inventory' ? { typeId: '5' } : null,
    targetBranchIds: changes.targetBranchIds,
    questions,
    schedule: changes.schedule,
    scheduleHistory,
    startsFrom: changes.schedule.startDate.slice(0, 7),
    version: (survey.version || 1) + (questionsChanged || scheduleChanged || kind !== (survey.kind || 'documents') ? 1 : 0),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'banItems', `survey_${survey.id}`), { type: 'survey', title: changes.title.trim() });
  await batch.commit();
};

export const updateSurveyStatus = async (surveyId, status) => {
  surveyCache.expiresAt = 0;
  await updateDoc(doc(db, SURVEYS, surveyId), {
    status,
    updatedAt: serverTimestamp(),
    ...(status === SURVEY_STATUS.PAUSED ? { pausedAt: serverTimestamp() } : {}),
  });
};

export const updateSurveyAudience = async (surveyId, targetBranchIds) => {
  surveyCache.expiresAt = 0;
  await updateDoc(doc(db, SURVEYS, surveyId), {
    targetBranchIds,
    excludedBranchIds: [],
    updatedAt: serverTimestamp(),
  });
};

export const getVisibleSurveysForBranch = async (branchId) => {
  const activeSurveys = query(collection(db, SURVEYS), where('status', '==', SURVEY_STATUS.ACTIVE));
  const snapshot = await getDocs(activeSurveys);

  return snapshot.docs
    .map((survey) => ({ id: survey.id, ...survey.data() }))
    .filter((survey) => survey.targetBranchIds?.includes(branchId) && !survey.excludedBranchIds?.includes(branchId))
    .map((survey) => ({ ...survey, occurrenceDate: getLatestDueOccurrence(survey) }))
    .filter((survey) => survey.occurrenceDate);
};

export const getSurveyResponse = async ({ surveyId, branchId, occurrenceDate, allowLegacy = false }) => {
  const response = await getDoc(doc(db, RESPONSES, responseId(surveyId, branchId, occurrenceDate)));
  if (response.exists()) return { id: response.id, ...response.data() };
  if (allowLegacy && occurrenceDate.endsWith('-01')) {
    const oldResponse = await getDoc(doc(db, RESPONSES, responseId(surveyId, branchId, occurrenceDate.slice(0, 7))));
    if (oldResponse.exists()) return { id: oldResponse.id, ...oldResponse.data(), occurrenceDate };
  }
  return null;
};

/**
 * Saves the selected response only while its occurrence is open to this branch.
 * 1. Re-read the survey and check its current or administrator-reopened deadline.
 * 2. Validate submitted answers and prepare the response under its stable ID.
 * 3. Save the response and consume a matching general attempt atomically.
 */
export const saveSurveyResponse = async ({ survey, branchId, userId, answers, status }) => {
  // STEP 1: The branch must still be targeted and within the permitted period.
  const occurrenceDate = survey.occurrenceDate || getLatestDueOccurrence(survey);
  if (!occurrenceDate) throw new Error('لم يحِن موعد هذا الاستبيان بعد.');
  const currentSurvey = await getDoc(doc(db, SURVEYS, survey.id));
  if (!currentSurvey.exists() || currentSurvey.data().status !== SURVEY_STATUS.ACTIVE ||
      !currentSurvey.data().targetBranchIds?.includes(branchId) || currentSurvey.data().excludedBranchIds?.includes(branchId)) {
    throw new Error('لم يعد هذا الاستبيان متاحًا لهذا الفرع.');
  }
  const liveSurvey = { id: survey.id, ...currentSurvey.data() };
  if (liveSurvey.kind === 'inventory') throw new Error('استبيان الجرد يُرسل من صفحة جرد الفرع المخصصة.');
  const liveSchedule = getScheduleForOccurrence(liveSurvey, occurrenceDate);
  const expired = liveSchedule.endOfDay && occurrenceDate < getZonedDateTime(new Date(), liveSchedule.timezone).date;
  const attemptRef = doc(db, 'banAttempts', branchId);
  let hasGeneralAttempt = false;
  if (expired) {
    const grant = await getDoc(doc(db, ACCESS_OVERRIDES, overrideId(survey.id, branchId, occurrenceDate)));
    const attempt = await getDoc(attemptRef);
    const source = attempt.data()?.status === 'active' ? await getDoc(doc(db, 'bansHistory', attempt.data().sourceBanId)) : null;
    hasGeneralAttempt = attempt.data()?.status === 'active' && attempt.data().expiresAt?.toDate?.() > new Date() &&
      attemptMatchesSurvey(source?.data(), survey.id, occurrenceDate);
    if (!hasGeneralAttempt && (!grant.exists() || grant.data().cancelledAt || !grant.data().expiresAt?.toDate || grant.data().expiresAt.toDate() <= new Date())) {
      throw new Error('انتهت مهلة الإدخال. تم تقييد حسابك لعدم الالتزام بمواعيد الإدخال.');
    }
  } else if (occurrenceDate !== getLatestDueOccurrence(liveSurvey)) {
    throw new Error('بدأ موعد جديد للاستبيان. حدّث الصفحة وأكمل الموعد الحالي.');
  }
  const month = occurrenceDate.slice(0, 7);
  const reference = doc(db, RESPONSES, responseId(survey.id, branchId, survey.schedule ? occurrenceDate : month));
  const existingResponse = await getDoc(reference);
  if (existingResponse.exists() && existingResponse.data().status === RESPONSE_STATUS.SUBMITTED) {
    throw new Error('تم إرسال الاستبيان لهذا الشهر. اطلب من الإدارة تصحيح الإجابة عند الحاجة.');
  }
  const cleanedAnswers = cleanSurveyAnswers(survey.questions, answers);
  if (status === RESPONSE_STATUS.SUBMITTED) {
    // STEP 2: A submitted answer must meet the survey's validation rules.
    const error = validateSurveyAnswers(survey.questions, cleanedAnswers);
    if (error) throw new Error(error);
  }
  const snapshot = {
    title: survey.title,
    version: survey.version || 1,
    scheduleType: getSurveySchedule(survey).type,
    questions: survey.questions.map(({ id, type, label, required, reasonRequiredWhen }) => ({
      id, type, label, required, reasonRequiredWhen: reasonRequiredWhen || null,
    })),
  };

  const responseData = {
    surveyId: survey.id,
    branchId,
    month,
    occurrenceDate,
    scheduledAt: Timestamp.fromDate(scheduledDateTime(occurrenceDate, getScheduleForOccurrence(survey, occurrenceDate))),
    status,
    answers: cleanedAnswers,
    surveySnapshot: snapshot,
    updatedAt: serverTimestamp(),
    ...(status === RESPONSE_STATUS.SUBMITTED ? {
      submittedAt: serverTimestamp(),
      submittedBy: userId,
    } : {}),
    ...(!existingResponse.exists() ? { createdAt: serverTimestamp() } : {}),
  };
  if (status !== RESPONSE_STATUS.SUBMITTED) {
    await setDoc(reference, responseData, { merge: true });
    return;
  }
  // STEP 3: A submitted response consumes its matching general attempt exactly once.
  await runTransaction(db, async (transaction) => {
    const [saved, attempt, branch] = await Promise.all([
      transaction.get(reference), transaction.get(attemptRef), transaction.get(doc(db, 'branches', branchId)),
    ]);
    if (saved.data()?.status === RESPONSE_STATUS.SUBMITTED) throw new Error('تم إرسال الاستبيان مسبقًا.');
    if (!branch.exists() || typeof branch.data().ban === 'string') throw new Error('الفرع محظور حاليًا.');
    let matches = false;
    if (attempt.data()?.status === 'active') {
      const source = await transaction.get(doc(db, 'bansHistory', attempt.data().sourceBanId));
      matches = attemptMatchesSurvey(source.data(), survey.id, occurrenceDate);
      if (matches && attempt.data().expiresAt?.toDate?.() <= new Date()) throw new Error('انتهت المحاولة الإضافية.');
    }
    if (hasGeneralAttempt && !matches) throw new Error('لم تعد المحاولة الإضافية متاحة.');
    transaction.set(reference, responseData, { merge: true });
    if (matches) transaction.update(attemptRef, { status: 'used', closedAt: serverTimestamp() });
  });
};

export const correctSurveyResponse = async ({ response, survey, answers, userId }) => {
  const questions = response.surveySnapshot?.questions || survey.questions;
  const cleanedAnswers = cleanSurveyAnswers(questions, answers);
  if (response.status === RESPONSE_STATUS.SUBMITTED) {
    const error = validateSurveyAnswers(questions, cleanedAnswers);
    if (error) throw new Error(error);
  }

  const responseReference = doc(db, RESPONSES, response.id);
  const revisionReference = doc(collection(db, REVISIONS));
  const batch = writeBatch(db);
  batch.update(responseReference, {
    answers: cleanedAnswers,
    updatedAt: serverTimestamp(),
    correctedBy: userId,
    correctedAt: serverTimestamp(),
  });
  batch.set(revisionReference, {
    surveyId: response.surveyId,
    responseId: response.id,
    branchId: response.branchId,
    month: getResponseMonth(response),
    previousAnswers: response.answers || {},
    newAnswers: cleanedAnswers,
    editedBy: userId,
    editedAt: serverTimestamp(),
  });
  await batch.commit();
  responseCache.delete(response.surveyId);
  return cleanedAnswers;
};

/**
 * Changes one product answer while preserving the other products and recording the revision.
 * 1. Read the current branch response in a transaction.
 * 2. Validate or remove the selected product answer and retain prior settlements.
 * 3. Save the response and its audit record atomically.
 */
export const changeInventoryProductAnswer = async ({ responseId, productId, actualQuantity, reason, remove = false, userId }) => {
  const responseReference = doc(db, RESPONSES, responseId);
  const revisionReference = doc(collection(db, REVISIONS));
  return runTransaction(db, async (transaction) => {
    // STEP 1: Use the latest response to avoid overwriting another product correction.
    const current = await transaction.get(responseReference);
    if (!current.exists()) throw new Error('لم تعد إجابة الفرع موجودة.');
    const response = current.data();
    const previous = response.inventoryAnswers?.[productId];
    if (!previous) throw new Error('لم تعد إجابة هذا الصنف موجودة.');

    // STEP 2: Keep the daily reference fixed and calculate only the difference not yet settled.
    const nextAnswers = { ...response.inventoryAnswers };
    if (remove) delete nextAnswers[productId];
    else {
      const actual = Number(actualQuantity);
      const expected = Number(previous.expectedQuantity);
      if (!Number.isFinite(actual) || actual < 0 || !Number.isFinite(expected)) throw new Error('أدخل كمية صحيحة.');
      // NOTE: The first correction must also account for surplus posted automatically on submission.
      const settledDifference = Number(previous.settledDifference ?? previous.appliedSurplus ?? 0);
      const difference = actual - expected - settledDifference;
      const cleanReason = difference === 0 ? '' : String(reason || '').trim();
      if (difference !== 0 && !cleanReason) throw new Error('أدخل سبب النقص أو الزيادة.');
      nextAnswers[productId] = { ...previous, actualQuantity: actual, difference, reason: cleanReason,
        ...(settledDifference !== 0 || previous.settledDifference !== undefined ? { settledDifference } : {}) };
    }

    // STEP 3: Store the scoped change and its audit entry together.
    transaction.update(responseReference, { inventoryAnswers: nextAnswers, updatedAt: serverTimestamp(), correctedAt: serverTimestamp(), correctedBy: userId });
    transaction.set(revisionReference, {
      surveyId: response.surveyId, responseId, branchId: response.branchId,
      month: response.month || response.occurrenceDate?.slice(0, 7), productId,
      action: remove ? 'delete_product_answer' : 'correct_product_answer',
      previousAnswer: previous, newAnswer: nextAnswers[productId] || null,
      editedBy: userId, editedAt: serverTimestamp(),
    });
    responseCache.delete(response.surveyId);
    return nextAnswers;
  });
};

/** Returns the calendar date used by daily inventory in Riyadh. */
const inventoryDateKey = (timestamp) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(timestamp.toDate());

/**
 * Transfers one outstanding survey difference to the branch's latest saved daily inventory.
 * 1. Resolve the latest report and unique stock records before starting the transaction.
 * 2. Recheck the response, latest day, and balances in the transaction.
 * 3. Apply the outstanding adjustment, preserve the reason and reference date, and zero the difference together.
 */
export const transferInventoryDifference = async ({ responseId, productId, expectedDifference, userId }) => {
  // STEP 1: Resolve document identities from the latest saved day; never use the survey's old reference day.
  if (auth.currentUser?.email?.toLowerCase() !== 'admin@saba321.com' || !userId || userId !== auth.currentUser.uid) {
    throw new Error('ترحيل الفروقات متاح للإدارة فقط.');
  }
  const responseRef = doc(db, RESPONSES, responseId);
  const responseSnapshot = await getDoc(responseRef);
  const response = responseSnapshot.data();
  if (!responseSnapshot.exists() || response.status !== RESPONSE_STATUS.SUBMITTED || !response.branchId) {
    throw new Error('إجابة الاستبيان غير متاحة للترحيل.');
  }
  const answer = response.inventoryAnswers?.[productId];
  if (!answer || !canTransferInventoryDifference(answer) ||
      Number(answer.difference) !== Number(expectedDifference) || !String(answer.reason || '').trim()) {
    throw new Error('تغير فارق الصنف أو سببه. حدّث الإجابة وحاول مجددًا.');
  }
  const branchId = response.branchId;
  const typeId = '5';
  const dates = await getDocs(query(collection(db, 'dailyReportsDates'),
    where('branchId', '==', branchId), where('typeId', '==', typeId)));
  const latest = dates.docs.filter((item) => item.data().date?.toMillis)
    .sort((left, right) => right.data().date.toMillis() - left.data().date.toMillis())[0];
  if (!latest) throw new Error('لا يوجد يوم جرد يومي محفوظ لهذا الفرع.');
  const targetDate = inventoryDateKey(latest.data().date);
  const start = Timestamp.fromDate(new Date(`${targetDate}T00:00:00+03:00`));
  const end = Timestamp.fromDate(new Date(`${targetDate}T23:59:59.999+03:00`));
  const summaryRef = doc(db, 'product_monthly_summaries', `${branchId}_${targetDate.slice(0, 7)}_${productId}`);
  const [reports, openings, markers, product, children, summarySnapshot] = await Promise.all([
    getDocs(query(collection(db, 'dailyReports'), where('branchId', '==', branchId),
      where('typeId', '==', typeId), where('date', '>=', start), where('date', '<=', end))),
    getDocs(query(collection(db, 'openingStock'), where('branchId', '==', branchId), where('typeId', '==', typeId))),
    getDocs(query(collection(db, 'dailyReportsUpdates'), where('branchId', '==', branchId), where('date', '==', start))),
    getDoc(doc(db, 'products', productId)),
    getDocs(query(collection(db, 'products'), where('parentProduct', '==', productId))),
    getDoc(summaryRef),
  ]);
  // NOTE: Grouped parent/child rows recalculate through child columns; changing one row alone would lose the adjustment.
  if (!product.exists()) throw new Error('لم يعد هذا الصنف موجودًا في قائمة المنتجات.');
  if (product.data().parentProduct || !children.empty) throw new Error('هذا الصنف مرتبط بأصناف فرعية ويحتاج تسوية يدوية.');
  const matchingReports = reports.docs.filter((item) => item.data().productId === productId);
  const matchingOpenings = openings.docs.filter((item) => item.data().productId === productId);
  const summaryDayKey = targetDate.slice(-2);
  const summaryData = summarySnapshot.data();
  const summaryDay = summaryData?.[`days.${summaryDayKey}`] ?? summaryData?.days?.[summaryDayKey];
  const newestMarker = [...markers.docs].sort((left, right) =>
    (right.data().updatedAt?.toMillis?.() ?? 0) - (left.data().updatedAt?.toMillis?.() ?? 0))[0]?.id;
  const duplicateGroups = [
    { collectionName: 'dailyReports', title: 'سجلات الجرد اليومي', documents: matchingReports },
    { collectionName: 'openingStock', title: 'الأرصدة الافتتاحية', documents: matchingOpenings },
    { collectionName: 'dailyReportsUpdates', title: 'علامات تحديث يوم الجرد', documents: markers.docs },
  ].filter((group) => group.documents.length > 1).map((group) => ({
    collectionName: group.collectionName, title: group.title,
    records: group.documents.map((item) => ({
      id: item.id,
      closeStock: item.data().closeStock ?? null,
      openingStockQnt: item.data().openingStockQnt ?? null,
      add: item.data().add ?? null,
      createdAt: item.data().createdAt?.toMillis?.() ?? null,
      updatedAt: item.data().updatedAt?.toMillis?.() ?? null,
      matchesSummary: group.collectionName === 'dailyReports'
        ? !!summaryDay && Number(item.data().closeStock) === Number(summaryDay.closeStock) &&
          Number(item.data().add || 0) === Number(summaryDay.add || 0)
        : group.collectionName === 'openingStock'
          ? !!summaryDay && Number(item.data().openingStockQnt) === Number(summaryDay.closeStock)
          : item.id === newestMarker,
    })),
  }));
  if (duplicateGroups.length) {
    const duplicateError = new Error(`توجد سجلات مكررة للصنف «${answer.productName}». راجعها قبل الترحيل.`);
    duplicateError.duplicateInventory = { productId, productName: answer.productName, branchId, targetDate, groups: duplicateGroups };
    throw duplicateError;
  }
  if (!matchingReports.length) throw new Error('لا يوجد سجل جرد يومي لهذا الصنف في آخر يوم محفوظ.');
  if (!matchingOpenings.length) throw new Error('لا يوجد رصيد افتتاحي لهذا الصنف.');
  if (!markers.size) throw new Error('لا توجد علامة تحديث لآخر يوم جرد محفوظ.');
  const reportRef = matchingReports[0].ref;
  const openingRef = matchingOpenings[0].ref;
  const markerRef = markers.docs[0].ref;
  const latestRef = doc(db, 'latestReportUpdate', `${branchId}_${typeId}`);
  const revisionRef = doc(collection(db, REVISIONS));

  // STEP 2: A concurrent submission, edit, transfer, or newer daily report must cancel this item.
  const inventoryAnswers = await runTransaction(db, async (transaction) => {
    const [current, day, latestUpdate, report, opening, summary, marker] = await Promise.all([
      transaction.get(responseRef), transaction.get(latest.ref), transaction.get(latestRef),
      transaction.get(reportRef), transaction.get(openingRef), transaction.get(summaryRef), transaction.get(markerRef),
    ]);
    const currentResponse = current.data();
    const previous = currentResponse?.inventoryAnswers?.[productId];
    if (!current.exists() || currentResponse.status !== RESPONSE_STATUS.SUBMITTED || currentResponse.branchId !== branchId ||
        !previous || !canTransferInventoryDifference(previous) ||
        Number(previous.difference) !== Number(expectedDifference) ||
        previous.reason !== answer.reason || previous.actualQuantity !== answer.actualQuantity ||
        previous.settledDifference !== answer.settledDifference || !day.exists() ||
        !latestUpdate.exists() || !latestUpdate.data().updatedAt ||
        inventoryDateKey(latestUpdate.data().updatedAt) !== targetDate ||
        !report.exists() || !opening.exists() || !summary.exists() || !marker.exists() ||
        report.data().productId !== productId || report.data().branchId !== branchId ||
        report.data().typeId !== typeId || !report.data().date ||
        inventoryDateKey(report.data().date) !== targetDate) {
      throw new Error('تغيرت بيانات الصنف أو آخر يوم جرد. حدّث الصفحة وحاول مجددًا.');
    }
    const oldClosing = Number(report.data().closeStock);
    const oldOpening = Number(opening.data().openingStockQnt);
    const oldAdd = Number(report.data().add || 0);
    const dayKey = targetDate.slice(-2);
    const summaryData = summary.data();
    const literalDay = summaryData[`days.${dayKey}`];
    const daySummary = literalDay ?? summaryData.days?.[dayKey];
    if (!Number.isFinite(oldClosing) || !Number.isFinite(oldOpening) || !Number.isFinite(oldAdd) ||
        !daySummary || Number(daySummary.closeStock) !== oldClosing ||
        Number(daySummary.add || 0) !== oldAdd || oldOpening !== oldClosing) {
      throw new Error('أرصدة الجرد وملخصه غير متطابقة لهذا الصنف؛ راجعها قبل الترحيل.');
    }
    const { rawDifference, pending, nextAdd, nextClosing } = calculateInventoryTransfer(previous, report.data());

    // STEP 3: Keep the branch's reason beside its reference inventory date in the daily note.
    const notePart = `(الجرد: ${String(previous.reason).trim()}، تاريخ الجرد: ${previous.referenceDate || targetDate})`;
    const oldNote = String(report.data().note || '').trim();
    const newNote = oldNote.split(' | ').includes(notePart) ? oldNote : oldNote ? `${oldNote} | ${notePart}` : notePart;
    transaction.update(reportRef, {
      add: nextAdd, closeStock: nextClosing, note: newNote, updatedAt: serverTimestamp(),
    });
    if (pending !== 0) {
      transaction.update(openingRef, { openingStockQnt: nextClosing, updatedAt: serverTimestamp() });
      const newDay = { ...daySummary, add: nextAdd, closeStock: nextClosing };
      transaction.set(summaryRef, literalDay
        ? { [`days.${dayKey}`]: newDay, updatedAt: serverTimestamp() }
        : { days: { [dayKey]: newDay }, updatedAt: serverTimestamp() }, { merge: true });
    }
    transaction.update(markerRef, { updatedAt: serverTimestamp() });
    const nextAnswers = { ...currentResponse.inventoryAnswers, [productId]: {
      ...previous, difference: 0, settledDifference: rawDifference,
      settledAt: Timestamp.now(), settledBy: userId, settledOnDate: targetDate,
    } };
    transaction.update(responseRef, { inventoryAnswers: nextAnswers, updatedAt: serverTimestamp() });
    transaction.set(revisionRef, {
      surveyId: currentResponse.surveyId, responseId, branchId, productId,
      month: currentResponse.month || currentResponse.occurrenceDate?.slice(0, 7),
      action: 'transfer_inventory_difference', previousAnswer: previous,
      newAnswer: nextAnswers[productId], transferredAmount: pending, targetDate,
      editedBy: userId, editedAt: serverTimestamp(),
    });
    return nextAnswers;
  });
  responseCache.delete(response.surveyId);
  return { inventoryAnswers, targetDate };
};

/**
 * Deletes one administrator-selected duplicate while retaining another scoped record and an audit copy.
 * 1. Recheck admin access, the response, latest day, and duplicate document IDs.
 * 2. Verify the selected and retained records in a transaction.
 * 3. Delete only the selected record and preserve its contents in the revision history.
 */
export const deleteDuplicateInventoryRecord = async ({ responseId, productId, targetDate, collectionName, documentId, keeperId, userId }) => {
  // STEP 1: A stale window or a different collection must not delete an unrelated record.
  if (auth.currentUser?.email?.toLowerCase() !== 'admin@saba321.com' ||
      !userId || userId !== auth.currentUser.uid) throw new Error('حذف السجلات المكررة متاح للإدارة فقط.');
  if (!['dailyReports', 'openingStock', 'dailyReportsUpdates'].includes(collectionName) ||
      !documentId || !keeperId || documentId === keeperId || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error('بيانات السجل المراد حذفه غير صالحة.');
  }
  const responseRef = doc(db, RESPONSES, responseId);
  const responseSnapshot = await getDoc(responseRef);
  const response = responseSnapshot.data();
  if (!responseSnapshot.exists() || response.status !== RESPONSE_STATUS.SUBMITTED ||
      !response.inventoryAnswers?.[productId] || !response.branchId) throw new Error('إجابة الصنف لم تعد متاحة.');
  const branchId = response.branchId;
  const typeId = '5';
  const dates = await getDocs(query(collection(db, 'dailyReportsDates'),
    where('branchId', '==', branchId), where('typeId', '==', typeId)));
  const latest = dates.docs.filter((item) => item.data().date?.toMillis)
    .sort((left, right) => right.data().date.toMillis() - left.data().date.toMillis())[0];
  if (!latest || inventoryDateKey(latest.data().date) !== targetDate) {
    throw new Error('تغير آخر يوم جرد. أعد المحاولة بعد تحديث البيانات.');
  }
  const start = Timestamp.fromDate(new Date(`${targetDate}T00:00:00+03:00`));
  const end = Timestamp.fromDate(new Date(`${targetDate}T23:59:59.999+03:00`));
  const scopedQuery = collectionName === 'openingStock'
    ? query(collection(db, collectionName), where('branchId', '==', branchId), where('typeId', '==', typeId))
    : collectionName === 'dailyReports'
      ? query(collection(db, collectionName), where('branchId', '==', branchId),
        where('typeId', '==', typeId), where('date', '>=', start), where('date', '<=', end))
      : query(collection(db, collectionName), where('branchId', '==', branchId), where('date', '==', start));
  const scopedSnapshot = await getDocs(scopedQuery);
  const matching = scopedSnapshot.docs.filter((item) => collectionName === 'dailyReportsUpdates' || item.data().productId === productId);
  if (matching.length < 2 || !matching.some((item) => item.id === documentId) ||
      !matching.some((item) => item.id === keeperId)) throw new Error('تغيرت السجلات المكررة. أعد فتح النافذة.');
  const selectedRef = doc(db, collectionName, documentId);
  const keeperRef = doc(db, collectionName, keeperId);
  const latestRef = doc(db, 'latestReportUpdate', `${branchId}_${typeId}`);
  const updateMarkers = collectionName === 'dailyReportsUpdates' ? null : await getDocs(query(
    collection(db, 'dailyReportsUpdates'), where('branchId', '==', branchId), where('date', '==', start)
  ));
  const markerRef = collectionName === 'dailyReportsUpdates' ? keeperRef : updateMarkers?.docs[0]?.ref;
  const revisionRef = doc(collection(db, REVISIONS));

  // STEP 2: Keep a surviving record, verify its scope, and guard against a newer report day.
  await runTransaction(db, async (transaction) => {
    const [currentResponse, day, latestUpdate, selected, keeper, marker] = await Promise.all([
      transaction.get(responseRef), transaction.get(latest.ref), transaction.get(latestRef),
      transaction.get(selectedRef), transaction.get(keeperRef),
      markerRef ? transaction.get(markerRef) : Promise.resolve(null),
    ]);
    const sameScope = (snapshot) => snapshot.exists() && snapshot.data().branchId === branchId &&
      (collectionName === 'dailyReportsUpdates'
        ? !!snapshot.data().date && inventoryDateKey(snapshot.data().date) === targetDate
        : snapshot.data().typeId === typeId && snapshot.data().productId === productId &&
          (collectionName === 'openingStock' ||
            (!!snapshot.data().date && inventoryDateKey(snapshot.data().date) === targetDate)));
    if (!currentResponse.exists() || currentResponse.data().status !== RESPONSE_STATUS.SUBMITTED ||
        currentResponse.data().branchId !== branchId ||
        !currentResponse.data().inventoryAnswers?.[productId] || !day.exists() ||
        !latestUpdate.exists() || !latestUpdate.data().updatedAt ||
        inventoryDateKey(latestUpdate.data().updatedAt) !== targetDate ||
        !sameScope(selected) || !sameScope(keeper)) {
      throw new Error('تغيرت بيانات السجلات. أعد فتح نافذة التكرار.');
    }
    // STEP 3: Preserve the deleted document for review before removing it from the live collection.
    transaction.set(revisionRef, {
      surveyId: currentResponse.data().surveyId, responseId, branchId, productId,
      month: currentResponse.data().month || currentResponse.data().occurrenceDate?.slice(0, 7),
      action: 'delete_duplicate_inventory_record', collectionName,
      documentId, retainedDocumentId: keeperId, targetDate,
      deletedRecord: selected.data(), editedBy: userId, editedAt: serverTimestamp(),
    });
    transaction.delete(selectedRef);
    if (markerRef && marker?.exists()) transaction.update(markerRef, { updatedAt: serverTimestamp() });
  });
  responseCache.delete(response.surveyId);
};

/**
 * Clears one branch response so the branch can submit the current occurrence again.
 * 1. Read the response and verify its scope.
 * 2. Preserve the former answers and applied surplus in the revision log.
 * 3. Delete only this response and invalidate its cached survey list.
 */
export const resetBranchSurveyResponse = async ({ responseId, surveyId, branchId, userId }) => {
  const responseReference = doc(db, RESPONSES, responseId);
  const surveyReference = doc(db, SURVEYS, surveyId);
  const revisionReference = doc(collection(db, REVISIONS));
  // STEP 1: Check the response currently stored, not the dashboard's cached copy.
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(responseReference);
    const surveyDocument = await transaction.get(surveyReference);
    if (!current.exists()) throw new Error('لم تعد إجابة الفرع موجودة.');
    const response = current.data();
    if (response.surveyId !== surveyId || response.branchId !== branchId) {
      throw new Error('إجابة الفرع لا تطابق الاستبيان المحدد.');
    }
    const survey = surveyDocument.exists() ? surveyDocument.data() : null;
    if (!survey || survey.status !== SURVEY_STATUS.ACTIVE ||
        !survey.targetBranchIds?.includes(branchId) || survey.excludedBranchIds?.includes(branchId) ||
        getLatestDueOccurrence(survey) !== occurrenceDateOfResponse({ id: responseId, ...response })) {
      throw new Error('هذا الموعد لم يعد متاحًا للفرع لإعادة التعبئة.');
    }
    // STEP 2: Keep an audit trail of the removed answer and its inventory adjustment.
    transaction.set(revisionReference, {
      surveyId, responseId, branchId,
      month: getResponseMonth({ id: responseId, ...response }),
      action: 'reset_branch_response',
      previousStatus: response.status,
      previousAnswers: response.answers || {},
      previousInventoryAnswers: response.inventoryAnswers || {},
      appliedSurplusTotal: Object.values(response.inventoryAnswers || {})
        .reduce((sum, answer) => sum + Number(answer.appliedSurplus || 0), 0),
      inventoryAdjustmentRetained: true,
      editedBy: userId, editedAt: serverTimestamp(),
    });
    // STEP 3: Removing this one response makes the current occurrence pending again.
    transaction.delete(responseReference);
  });
  responseCache.delete(surveyId);
};

export const getResponsesByMonth = async (month) => {
  const responseQuery = query(collection(db, RESPONSES), where('month', '==', month));
  const snapshot = await getDocs(responseQuery);
  return snapshot.docs.map((response) => ({ id: response.id, ...response.data() }));
};

export const getResponsesForSurvey = async (surveyId) => {
  const cached = responseCache.get(surveyId);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  const snapshot = await getDocs(query(collection(db, RESPONSES), where('surveyId', '==', surveyId)));
  const value = snapshot.docs.map((response) => ({ id: response.id, ...response.data() }));
  responseCache.set(surveyId, { value, expiresAt: Date.now() + CACHE_MS });
  return value;
};

const deleteDocuments = async (documents) => {
  for (let index = 0; index < documents.length; index += 450) {
    const batch = writeBatch(db);
    documents.slice(index, index + 450).forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }
};

export const deleteSurveyMonth = async (surveyId, month) => {
  responseCache.delete(surveyId);
  const responses = await getDocs(query(collection(db, RESPONSES), where('surveyId', '==', surveyId)));
  const revisions = await getDocs(query(collection(db, REVISIONS), where('surveyId', '==', surveyId)));
  const grants = await getDocs(query(collection(db, ACCESS_OVERRIDES), where('surveyId', '==', surveyId)));
  const monthResponses = responses.docs.filter((response) => getResponseMonth({ id: response.id, ...response.data() }) === month);
  const monthRevisions = revisions.docs.filter((revision) => revision.data().month === month);
  await deleteDocuments([...monthRevisions, ...monthResponses,
    ...grants.docs.filter((grant) => grant.data().occurrenceDate?.slice(0, 7) === month)]);
  return monthResponses.length;
};

export const deleteSurveyPermanently = async (surveyId) => {
  responseCache.delete(surveyId);
  surveyCache.expiresAt = 0;
  const responses = await getDocs(query(collection(db, RESPONSES), where('surveyId', '==', surveyId)));
  const revisions = await getDocs(query(collection(db, REVISIONS), where('surveyId', '==', surveyId)));
  const grants = await getDocs(query(collection(db, ACCESS_OVERRIDES), where('surveyId', '==', surveyId)));
  await deleteDocuments([...revisions.docs, ...responses.docs, ...grants.docs]);
  await deleteDoc(doc(db, SURVEYS, surveyId));
  return responses.size;
};
