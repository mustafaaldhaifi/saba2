import { QUESTION_TYPES } from './surveyConstants.js';

const cleanText = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const cleanDigits = (value) => String(value ?? '')
  .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
  .replace(/[^0-9]/g, '');
const cleanPhone = (value) => {
  const digits = cleanDigits(value);
  return digits.startsWith('9665') && digits.length === 12 ? `0${digits.slice(3)}` : digits;
};
const validDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` === value;
};

export const emptyWorker = () => ({
  id: crypto.randomUUID(), fullName: '', employeeNumber: '', identityNumber: '', phoneNumber: '', hasBranchFingerprint: '',
  healthCertificateStatus: 'available', educationCertificateStatus: 'available',
  healthCertificateExpiryDate: '', educationExpiryDate: '', healthCertificateExpiryDateCalendar: 'gregorian', educationExpiryDateCalendar: 'gregorian',
});

export const cleanSurveyAnswers = (questions, answers) => Object.fromEntries(questions.map((question) => {
  const answer = answers?.[question.id] || {};
  if (question.type === QUESTION_TYPES.DOCUMENT) return [question.id, { status: answer.status === 'missing' ? 'missing' : 'available', documentNumber: answer.status === 'missing' ? '' : cleanText(answer.documentNumber), expiryDate: answer.status === 'missing' ? '' : answer.expiryDate || '', expiryDateCalendar: answer.expiryDateCalendar === 'hijri' ? 'hijri' : 'gregorian' }];
  if (question.type === QUESTION_TYPES.YES_NO) return [question.id, { value: answer.value === 'yes' || answer.value === 'no' ? answer.value : '', reason: answer.value === 'no' ? cleanText(answer.reason) : '' }];
  if (question.type === QUESTION_TYPES.NOTES) return [question.id, { value: cleanText(answer.value) }];
  if (question.type === QUESTION_TYPES.HEALTH_DOCUMENTS) return [question.id, {
    workers: (Array.isArray(answer.workers) ? answer.workers : [])
      .map((worker) => ({
        id: worker.id || crypto.randomUUID(),
        fullName: cleanText(worker.fullName),
        employeeNumber: cleanText(worker.employeeNumber),
        identityNumber: cleanDigits(worker.identityNumber),
        phoneNumber: cleanPhone(worker.phoneNumber),
        hasBranchFingerprint: ['yes', 'no'].includes(worker.hasBranchFingerprint) ? worker.hasBranchFingerprint : '',
        healthCertificateStatus: worker.healthCertificateStatus === 'missing' ? 'missing' : 'available',
        educationCertificateStatus: worker.educationCertificateStatus === 'missing' ? 'missing' : 'available',
        healthCertificateExpiryDate: worker.healthCertificateStatus === 'missing' ? '' : worker.healthCertificateExpiryDate || '',
        healthCertificateExpiryDateCalendar: worker.healthCertificateExpiryDateCalendar === 'hijri' ? 'hijri' : 'gregorian',
        educationExpiryDate: worker.educationCertificateStatus === 'missing' ? '' : worker.educationExpiryDate || '',
        educationExpiryDateCalendar: worker.educationExpiryDateCalendar === 'hijri' ? 'hijri' : 'gregorian',
      }))
      .filter((worker) => worker.fullName || worker.employeeNumber || worker.identityNumber || worker.phoneNumber || worker.hasBranchFingerprint || worker.healthCertificateExpiryDate || worker.educationExpiryDate),
  }];
  return [question.id, answer];
}));

export const validateSurveyAnswers = (questions, answers) => {
  for (const question of questions) {
    const answer = answers?.[question.id] || {};
    if (question.type === QUESTION_TYPES.DOCUMENT) {
      if (answer.status !== 'missing' && question.required && (!answer.documentNumber || !answer.expiryDate)) return `أكمل بيانات: ${question.label}`;
      if (answer.status !== 'missing' && answer.expiryDate && !validDate(answer.expiryDate)) return `تاريخ انتهاء غير صحيح: ${question.label}`;
    }
    if (question.type === QUESTION_TYPES.YES_NO) {
      if (question.required && !['yes', 'no'].includes(answer.value)) return `اختر إجابة: ${question.label}`;
      if (answer.value === 'no' && question.reasonRequiredWhen === 'no' && !answer.reason) return `أدخل السبب: ${question.label}`;
    }
    if (question.type === QUESTION_TYPES.NOTES && question.required && !answer.value) return `أدخل: ${question.label}`;
    if (question.type === QUESTION_TYPES.HEALTH_DOCUMENTS) {
      const workers = answer.workers || [];
      if (question.required && workers.length === 0) return `أضف عاملاً واحداً على الأقل في: ${question.label}`;
      const identities = new Set();
      for (const [index, worker] of workers.entries()) {
        if (worker.fullName.split(' ').length < 4) return `أدخل الاسم الرباعي للعامل ${index + 1}`;
        if (!worker.employeeNumber) return `أدخل الرقم الوظيفي للعامل ${index + 1}`;
        if (!/^\d{10}$/.test(worker.identityNumber)) return `رقم هوية العامل ${index + 1} يجب أن يكون 10 أرقام`;
        if (!/^05\d{8}$/.test(worker.phoneNumber)) return `رقم جوال العامل ${index + 1} يجب أن يبدأ بـ 05 ويتكون من 10 أرقام`;
        if (!['yes', 'no'].includes(worker.hasBranchFingerprint)) return `حدد هل توجد بصمة للعامل ${index + 1} في الفرع`;
        if ((worker.healthCertificateStatus !== 'missing' && !validDate(worker.healthCertificateExpiryDate)) || (worker.educationCertificateStatus !== 'missing' && !validDate(worker.educationExpiryDate))) return `أكمل تواريخ انتهاء وثائق العامل ${index + 1} أو حدد أنها غير موجودة`;
        if (identities.has(worker.identityNumber)) return `رقم هوية مكرر في: ${question.label}`;
        identities.add(worker.identityNumber);
      }
    }
  }
  return null;
};
