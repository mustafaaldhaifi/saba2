import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSurveyAnswers, validateSurveyAnswers } from './surveyValidation.js';

const questions = [{ id: 'health', type: 'health_documents', label: 'الوثائق الصحية', required: true }];

test('normalizes worker identity and phone digits without losing leading zeros', () => {
  const answers = cleanSurveyAnswers(questions, { health: { workers: [{
    id: 'worker-1', fullName: '  أحمد   محمد علي صالح  ', identityNumber: '١٢٣٤٥٦٧٨٩٠',
    employeeNumber: ' EMP-1024 ', phoneNumber: '+966 ٥٠ ١٢٣ ٤٥٦٧', hasBranchFingerprint: 'yes', healthCertificateExpiryDate: '2027-05-30', educationExpiryDate: '2027-08-15',
  }] } });
  assert.equal(answers.health.workers[0].fullName, 'أحمد محمد علي صالح');
  assert.equal(answers.health.workers[0].identityNumber, '1234567890');
  assert.equal(answers.health.workers[0].phoneNumber, '0501234567');
  assert.equal(answers.health.workers[0].employeeNumber, 'EMP-1024');
  assert.equal(answers.health.workers[0].hasBranchFingerprint, 'yes');
  assert.equal(validateSurveyAnswers(questions, answers), null);
});

test('rejects duplicate identities and invalid calendar dates', () => {
  const worker = { id: 'one', fullName: 'أحمد محمد علي صالح', employeeNumber: 'EMP-1024', identityNumber: '1234567890', phoneNumber: '0501234567', hasBranchFingerprint: 'no', healthCertificateExpiryDate: '2027-02-30', educationExpiryDate: '2027-08-15' };
  assert.match(validateSurveyAnswers(questions, { health: { workers: [worker] } }), /تواريخ انتهاء/);
  const validWorker = { ...worker, healthCertificateExpiryDate: '2027-02-28' };
  assert.match(validateSurveyAnswers(questions, { health: { workers: [validWorker, { ...validWorker, id: 'two' }] } }), /مكرر/);
});

test('requires employee number and branch fingerprint for submitted workers', () => {
  const worker = { id: 'one', fullName: 'أحمد محمد علي صالح', identityNumber: '1234567890', phoneNumber: '0501234567', healthCertificateExpiryDate: '2027-05-30', educationExpiryDate: '2027-08-15' };
  assert.match(validateSurveyAnswers(questions, { health: { workers: [worker] } }), /الرقم الوظيفي/);
  assert.match(validateSurveyAnswers(questions, { health: { workers: [{ ...worker, employeeNumber: 'EMP-1024' }] } }), /بصمة/);
  assert.equal(validateSurveyAnswers(questions, { health: { workers: [{ ...worker, employeeNumber: 'EMP-1024', hasBranchFingerprint: 'no' }] } }), null);
});

test('preserves the selected calendar for expiry dates', () => {
  const cleaned = cleanSurveyAnswers([
    { id: 'document', type: 'document' },
    { id: 'health', type: 'health_documents' },
  ], {
    document: { expiryDate: '2026-10-28', expiryDateCalendar: 'hijri' },
    health: { workers: [{ id: 'one', fullName: 'أحمد محمد علي صالح', healthCertificateExpiryDate: '2026-10-28', healthCertificateExpiryDateCalendar: 'hijri' }] },
  });
  assert.equal(cleaned.document.expiryDateCalendar, 'hijri');
  assert.equal(cleaned.health.workers[0].healthCertificateExpiryDateCalendar, 'hijri');
});
