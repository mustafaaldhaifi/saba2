import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSurveyAnswers, validateSurveyAnswers } from './surveyValidation.js';

const questions = [{ id: 'health', type: 'health_documents', label: 'الوثائق الصحية', required: true }];

test('normalizes worker identity and phone digits without losing leading zeros', () => {
  const answers = cleanSurveyAnswers(questions, { health: { workers: [{
    id: 'worker-1', fullName: '  أحمد   محمد علي صالح  ', identityNumber: '١٢٣٤٥٦٧٨٩٠',
    phoneNumber: '+966 ٥٠ ١٢٣ ٤٥٦٧', healthCertificateExpiryDate: '2027-05-30', educationExpiryDate: '2027-08-15',
  }] } });
  assert.equal(answers.health.workers[0].fullName, 'أحمد محمد علي صالح');
  assert.equal(answers.health.workers[0].identityNumber, '1234567890');
  assert.equal(answers.health.workers[0].phoneNumber, '0501234567');
  assert.equal(validateSurveyAnswers(questions, answers), null);
});

test('rejects duplicate identities and invalid calendar dates', () => {
  const worker = { id: 'one', fullName: 'أحمد محمد علي صالح', identityNumber: '1234567890', phoneNumber: '0501234567', healthCertificateExpiryDate: '2027-02-30', educationExpiryDate: '2027-08-15' };
  assert.match(validateSurveyAnswers(questions, { health: { workers: [worker] } }), /تاريخي انتهاء/);
  const validWorker = { ...worker, healthCertificateExpiryDate: '2027-02-28' };
  assert.match(validateSurveyAnswers(questions, { health: { workers: [validWorker, { ...validWorker, id: 'two' }] } }), /مكرر/);
});
