import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../config/firebase';
import { RESPONSE_STATUS, SURVEY_STATUS, getCurrentMonth } from './surveyConstants';

const SURVEYS = 'surveys';
const RESPONSES = 'surveyResponses';

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
    answers,
    surveySnapshot: snapshot,
    updatedAt: serverTimestamp(),
    ...(status === RESPONSE_STATUS.SUBMITTED ? {
      submittedAt: serverTimestamp(),
      submittedBy: userId,
    } : {}),
    ...(!existingResponse.exists() ? { createdAt: serverTimestamp() } : {}),
  }, { merge: true });
};

export const getResponsesByMonth = async (month) => {
  const responseQuery = query(collection(db, RESPONSES), where('month', '==', month));
  const snapshot = await getDocs(responseQuery);
  return snapshot.docs.map((response) => ({ id: response.id, ...response.data() }));
};
