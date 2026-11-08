import {
  addDoc,
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

export const getSurveyAccessOverrides = async (surveyId) => {
  const snapshot = await getDocs(query(collection(db, ACCESS_OVERRIDES), where('surveyId', '==', surveyId)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
};

/**
 * Reopens one expired survey occurrence for an administrator-selected period.
 * 1. Verify the administrator, target branch, expired date, and absence of submission.
 * 2. Save a grant scoped to the survey, branch, and occurrence.
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
  // STEP 2: Use a stable document ID so extending a grant updates the same occurrence.
  await setDoc(doc(db, ACCESS_OVERRIDES, overrideId(surveyId, branchId, occurrenceDate)), {
    surveyId, branchId, occurrenceDate, expiresAt: Timestamp.fromDate(expiresAt),
    grantedAt: serverTimestamp(), grantedBy: userId,
  });
};

/**
 * Resolves the oldest missed survey for a branch and whether administration reopened it.
 * 1. Read the branch's active surveys, answers, and access grants.
 * 2. Find the earliest unanswered date after its end-of-day deadline.
 */
export const getBranchSurveyRestriction = async (branchId) => {
  // STEP 1: Read current documents rather than cached survey or response lists.
  const [surveys, responses, overrides] = await Promise.all([
    getDocs(query(collection(db, SURVEYS), where('status', '==', SURVEY_STATUS.ACTIVE))),
    getDocs(query(collection(db, RESPONSES), where('branchId', '==', branchId))),
    getDocs(query(collection(db, ACCESS_OVERRIDES), where('branchId', '==', branchId))),
  ]);
  const answers = responses.docs.map((item) => ({ id: item.id, ...item.data() }));
  const grants = overrides.docs.map((item) => item.data());
  // STEP 2: A live grant opens only its named occurrence, not the branch dashboard.
  const missed = surveys.docs.flatMap((item) => {
    const survey = { id: item.id, ...item.data() };
    if (!survey.targetBranchIds?.includes(branchId) || survey.excludedBranchIds?.includes(branchId)) return [];
    return getExpiredOccurrences(survey, answers.filter((answer) => answer.surveyId === survey.id))
      .map((occurrenceDate) => ({ survey, occurrenceDate }));
  }).sort((left, right) => left.occurrenceDate.localeCompare(right.occurrenceDate));
  const first = missed[0];
  if (!first) return null;
  const grant = grants.find((item) => item.surveyId === first.survey.id && item.occurrenceDate === first.occurrenceDate);
  return { ...first, reopened: !!grant?.expiresAt?.toDate && grant.expiresAt.toDate() > new Date() };
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

export const createSurvey = async ({ title, description, kind = 'documents', targetBranchIds, questions, schedule }) => {
  surveyCache.expiresAt = 0;
  const cleanQuestions = (kind === 'inventory' ? [] : questions).map((question) => ({
    ...question,
    label: question.label.trim(),
  }));

  return addDoc(collection(db, SURVEYS), {
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
};

export const updateSurvey = async (survey, changes) => {
  surveyCache.expiresAt = 0;
  const kind = changes.kind || 'documents';
  const questions = (kind === 'inventory' ? [] : changes.questions).map((question) => ({ ...question, label: question.label.trim() }));
  const questionsChanged = JSON.stringify(questions) !== JSON.stringify(survey.questions);
  const scheduleChanged = JSON.stringify(changes.schedule) !== JSON.stringify(getSurveySchedule(survey));
  const scheduleHistory = scheduleChanged ? [
    ...(survey.scheduleHistory || []),
    { ...getSurveySchedule(survey), endDate: changes.schedule.startDate },
  ] : survey.scheduleHistory || [];
  await updateDoc(doc(db, SURVEYS, survey.id), {
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
 * 2. Validate submitted answers and save the response under its stable ID.
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
  if (expired) {
    const grant = await getDoc(doc(db, ACCESS_OVERRIDES, overrideId(survey.id, branchId, occurrenceDate)));
    if (!grant.exists() || !grant.data().expiresAt?.toDate || grant.data().expiresAt.toDate() <= new Date()) {
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

  await setDoc(reference, {
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
  }, { merge: true });
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
 * 2. Validate or remove the selected product answer.
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

    // STEP 2: Keep the daily reference fixed and recalculate the difference.
    const nextAnswers = { ...response.inventoryAnswers };
    if (remove) delete nextAnswers[productId];
    else {
      const actual = Number(actualQuantity);
      const expected = Number(previous.expectedQuantity);
      if (!Number.isFinite(actual) || actual < 0 || !Number.isFinite(expected)) throw new Error('أدخل كمية صحيحة.');
      const difference = actual - expected;
      const cleanReason = difference === 0 ? '' : String(reason || '').trim();
      if (difference !== 0 && !cleanReason) throw new Error('أدخل سبب النقص أو الزيادة.');
      nextAnswers[productId] = { ...previous, actualQuantity: actual, difference, reason: cleanReason };
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
