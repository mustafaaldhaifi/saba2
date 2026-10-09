import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../config/firebase';
import { RESPONSE_STATUS, SURVEY_STATUS, getCurrentMonth } from './surveyConstants';
import { cleanSurveyAnswers, validateSurveyAnswers } from './surveyValidation';

const SURVEYS = 'surveys';
const RESPONSES = 'surveyResponses';
const REVISIONS = 'surveyResponseRevisions';

const responseId = (surveyId, branchId, month) => `${surveyId}__${branchId}__${month}`;

export const getBranches = async () => {
  const snapshot = await getDocs(collection(db, 'branches'));
  return snapshot.docs
    .map((branch) => ({ id: branch.id, ...branch.data() }))
    .sort((first, second) => (first.name || first.id).localeCompare(second.name || second.id, 'ar'));
};

export const getSurveys = async () => {
  const snapshot = await getDocs(collection(db, SURVEYS));
  return snapshot.docs
    .map((survey) => ({ id: survey.id, ...survey.data() }))
    .sort((first, second) => (second.createdAt?.seconds || 0) - (first.createdAt?.seconds || 0));
};

export const createSurvey = async ({ title, description, targetBranchIds, questions }) => {
  const cleanQuestions = questions.map((question) => ({
    ...question,
    label: question.label.trim(),
  }));

  return addDoc(collection(db, SURVEYS), {
    title: title.trim(),
    description: description.trim(),
    status: SURVEY_STATUS.ACTIVE,
    startsFrom: getCurrentMonth(),
    targetBranchIds,
    excludedBranchIds: [],
    questions: cleanQuestions,
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const updateSurvey = async (survey, changes) => {
  const questions = changes.questions.map((question) => ({ ...question, label: question.label.trim() }));
  const questionsChanged = JSON.stringify(questions) !== JSON.stringify(survey.questions);
  await updateDoc(doc(db, SURVEYS, survey.id), {
    title: changes.title.trim(),
    description: changes.description.trim(),
    targetBranchIds: changes.targetBranchIds,
    questions,
    version: (survey.version || 1) + (questionsChanged ? 1 : 0),
    updatedAt: serverTimestamp(),
  });
};

export const updateSurveyStatus = async (surveyId, status) => {
  await updateDoc(doc(db, SURVEYS, surveyId), {
    status,
    updatedAt: serverTimestamp(),
    ...(status === SURVEY_STATUS.PAUSED ? { pausedAt: serverTimestamp() } : {}),
  });
};

export const updateSurveyAudience = async (surveyId, targetBranchIds) => {
  await updateDoc(doc(db, SURVEYS, surveyId), {
    targetBranchIds,
    excludedBranchIds: [],
    updatedAt: serverTimestamp(),
  });
};

export const getVisibleSurveysForBranch = async (branchId, month = getCurrentMonth()) => {
  const activeSurveys = query(collection(db, SURVEYS), where('status', '==', SURVEY_STATUS.ACTIVE));
  const snapshot = await getDocs(activeSurveys);

  return snapshot.docs
    .map((survey) => ({ id: survey.id, ...survey.data() }))
    .filter((survey) => (
      survey.startsFrom <= month
      && survey.targetBranchIds?.includes(branchId)
      && !survey.excludedBranchIds?.includes(branchId)
    ));
};

export const getSurveyResponse = async ({ surveyId, branchId, month = getCurrentMonth() }) => {
  const response = await getDoc(doc(db, RESPONSES, responseId(surveyId, branchId, month)));
  return response.exists() ? { id: response.id, ...response.data() } : null;
};

export const saveSurveyResponse = async ({ survey, branchId, userId, answers, status }) => {
  const month = getCurrentMonth();
  const reference = doc(db, RESPONSES, responseId(survey.id, branchId, month));
  const existingResponse = await getDoc(reference);
  if (existingResponse.exists() && existingResponse.data().status === RESPONSE_STATUS.SUBMITTED) {
    throw new Error('تم إرسال الاستبيان لهذا الشهر. اطلب من الإدارة تصحيح الإجابة عند الحاجة.');
  }
  const cleanedAnswers = cleanSurveyAnswers(survey.questions, answers);
  if (status === RESPONSE_STATUS.SUBMITTED) {
    const error = validateSurveyAnswers(survey.questions, cleanedAnswers);
    if (error) throw new Error(error);
  }
  const snapshot = {
    title: survey.title,
    version: survey.version || 1,
    questions: survey.questions.map(({ id, type, label, required, reasonRequiredWhen }) => ({
      id, type, label, required, reasonRequiredWhen: reasonRequiredWhen || null,
    })),
  };

  await setDoc(reference, {
    surveyId: survey.id,
    branchId,
    month,
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
    month: response.month,
    previousAnswers: response.answers || {},
    newAnswers: cleanedAnswers,
    editedBy: userId,
    editedAt: serverTimestamp(),
  });
  await batch.commit();
  return cleanedAnswers;
};

export const getResponsesByMonth = async (month) => {
  const responseQuery = query(collection(db, RESPONSES), where('month', '==', month));
  const snapshot = await getDocs(responseQuery);
  return snapshot.docs.map((response) => ({ id: response.id, ...response.data() }));
};

export const getResponsesForSurvey = async (surveyId) => {
  const snapshot = await getDocs(query(collection(db, RESPONSES), where('surveyId', '==', surveyId)));
  return snapshot.docs.map((response) => ({ id: response.id, ...response.data() }));
};

const deleteDocuments = async (documents) => {
  for (let index = 0; index < documents.length; index += 450) {
    const batch = writeBatch(db);
    documents.slice(index, index + 450).forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }
};

export const deleteSurveyMonth = async (surveyId, month) => {
  const responses = await getDocs(query(collection(db, RESPONSES), where('surveyId', '==', surveyId)));
  const revisions = await getDocs(query(collection(db, REVISIONS), where('surveyId', '==', surveyId)));
  const monthResponses = responses.docs.filter((response) => response.data().month === month);
  const monthRevisions = revisions.docs.filter((revision) => revision.data().month === month);
  await deleteDocuments([...monthRevisions, ...monthResponses]);
  return monthResponses.length;
};

export const deleteSurveyPermanently = async (surveyId) => {
  const responses = await getDocs(query(collection(db, RESPONSES), where('surveyId', '==', surveyId)));
  const revisions = await getDocs(query(collection(db, REVISIONS), where('surveyId', '==', surveyId)));
  await deleteDocuments([...revisions.docs, ...responses.docs]);
  await deleteDoc(doc(db, SURVEYS, surveyId));
  return responses.size;
};
