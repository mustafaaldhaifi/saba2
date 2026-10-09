# عقد الاستبيانات مع تطبيق الفروع (Angular)

تقرأ الإدارة الاستبيانات من مجموعة Firestore المسماة `surveys` والإجابات من `surveyResponses`. يجب أن يستخدم تطبيق Angular المعرف الحقيقي للفرع في `targetBranchIds` و`branchId`.

## وثيقة الاستبيان الكاملة

المعرف هو معرف وثيقة Firestore في `surveys/{surveyId}` وليس حقلاً إلزامياً داخل البيانات. مثال:

```json
{
  "title": "استبيان وثائق الفرع",
  "description": "متابعة الوثائق والتصحيحات",
  "status": "active",
  "startsFrom": "2026-10",
  "targetBranchIds": ["branch_1", "branch_2"],
  "excludedBranchIds": [],
  "schedule": {
    "type": "weekly",
    "startDate": "2026-10-09",
    "weekDay": 1,
    "timezone": "Asia/Riyadh",
    "missedPolicy": "latest_only"
  },
  "scheduleHistory": [],
  "version": 2,
  "questions": [
    { "id": "license", "type": "document", "label": "رخصة البلدية", "required": true },
    { "id": "fixed", "type": "yes_no", "label": "هل تم التصحيح؟", "required": true, "reasonRequiredWhen": "no" },
    { "id": "notes", "type": "notes", "label": "ملاحظات الفرع", "required": false },
    { "id": "health", "type": "health_documents", "label": "الوثائق الصحية", "required": true }
  ],
  "createdAt": "Firestore Timestamp",
  "updatedAt": "Firestore Timestamp"
}
```

`status` أحد القيم `active` أو `paused` أو `archived`. يظهر الاستبيان فقط عندما يكون نشطاً، والفرع ضمن `targetBranchIds` وخارج `excludedBranchIds`. حالة الاستبيان لا تغير الإجابات السابقة. `startsFrom` حقل توافق مع البيانات القديمة؛ الجدولة الجديدة تعتمد `schedule.startDate`.

## أنواع الإجابات

تخزن الإجابات في كائن `answers` بمفتاح يساوي `question.id`، وليس اسم السؤال:

```json
{
  "license": { "documentNumber": "123456", "expiryDate": "2027-05-30" },
  "fixed": { "value": "no", "reason": "بانتظار اعتماد الجهة" },
  "notes": { "value": "تمت المراجعة" },
  "health": { "workers": [] }
}
```

عند `yes_no` تكون `value` إما `yes` أو `no`، ويصبح `reason` إلزامياً إذا كانت `value: "no"` و`reasonRequiredWhen: "no"`. للمسودة `draft` يمكن ترك الأسئلة ناقصة؛ عند `submitted` يجب التحقق من كل سؤال مطلوب. تحفظ `surveySnapshot` بنسخة عنوان الاستبيان ورقمه وأسئلته وقت الإجابة كي تبقى الشهور الماضية مفهومة بعد تعديل الاستبيان.

## نوع الوثائق الصحية

إذا كان السؤال `type: "health_documents"`، يعرض تطبيق الفرع قائمة عمال قابلة للإضافة. تخزن الإجابة تحت معرف السؤال:

```json
{
  "workers": [
    {
      "id": "معرف ثابت للصف",
      "fullName": "الاسم الرباعي",
      "identityNumber": "1234567890",
      "phoneNumber": "0501234567",
      "healthCertificateExpiryDate": "2027-05-30",
      "educationExpiryDate": "2027-08-15"
    }
  ]
}
```

الهوية والجوال نصوص، لا أرقام. قبل الإرسال يجب أن يحتوي الاسم على أربعة أجزاء، والهوية 10 أرقام، والجوال السعودي 10 أرقام يبدأ بـ `05`، والتواريخ صحيحة بصيغة `YYYY-MM-DD`. لا تُقبل هوية مكررة بين العمال في السؤال نفسه. إذا كان السؤال `required: true`، يلزم عامل واحد على الأقل.

## جدولة الظهور والإلزام

يحفظ الاستبيان حقل `schedule` بالشكل التالي:

```json
{
  "type": "daily",
  "startDate": "2026-10-09",
  "weekDay": 1,
  "timezone": "Asia/Riyadh",
  "missedPolicy": "latest_only"
}
```

`type` أحد القيم `daily` أو `weekly` أو `month_start` أو `month_end`. يستخدم `weekDay` فقط مع الأسبوعي وفق ترقيم ISO: الاثنين 1 حتى الأحد 7. بداية الشهر هي اليوم الأول، ونهاية الشهر هي آخر يوم فعلي. يبدأ استحقاق الموعد مع بداية اليوم بتوقيت `Asia/Riyadh`، وليس توقيت جهاز الفرع. حقل `time` القديم، إن وجد في وثيقة سابقة، لا يؤثر على الظهور.

`schedule.startDate` شامل. عند تغيير الجدولة تحفظ الإدارة الجدولة القديمة في `scheduleHistory` مع `endDate` غير شامل، وتبدأ الجدولة الجديدة من `schedule.startDate`. مثال:

```json
"scheduleHistory": [
  { "type": "month_start", "startDate": "2026-08-01", "endDate": "2026-10-09", "timezone": "Asia/Riyadh", "missedPolicy": "latest_only" }
]
```

يُستخدم هذا السجل لحساب المواعيد القديمة التي لم تُرسل فيها إجابة في تقرير الإدارة. عند حساب آخر موعد مستحق يجب الجمع بين سجل الجدولات والجدولة الحالية، وترتيب تواريخ الظهور واختيار الأحدث الذي بدأ فعلاً.

يجب أن يحسب حارس مسارات Angular **آخر موعد مستحق فقط** لكل استبيان نشط ومخصص للفرع. يسمح بدخول صفحات الفرع إذا كان رد هذا الموعد بحالة `submitted`؛ وإلا يحوله إلى صفحة الاستبيان الإلزامي. المواعيد الأقدم غير المكتملة تظهر في متابعة الإدارة لكنها لا تمنع الدخول. الاستبيان الموقوف أو المؤرشف لا يمنع الدخول.

معرف وثيقة الإجابة لكل موعد هو `{surveyId}__{branchId}__{YYYY-MM-DD}`، حيث الجزء الأخير هو **تاريخ الظهور** في الرياض. وتحفظ الوثيقة:

```json
{
  "surveyId": "licenses_survey",
  "branchId": "branch_1",
  "occurrenceDate": "2026-10-09",
  "month": "2026-10",
  "scheduledAt": "Firestore Timestamp",
  "status": "submitted",
  "answers": {},
  "surveySnapshot": {
    "title": "استبيان وثائق الفرع",
    "version": 2,
    "scheduleType": "daily",
    "questions": []
  },
  "createdAt": "Firestore Timestamp",
  "updatedAt": "Firestore Timestamp",
  "submittedAt": "Firestore Timestamp",
  "submittedBy": "user uid"
}
```

حالة الإكمال الوحيدة هي `submitted`. بعد الإرسال تُعرض الإجابة للفرع دون تعديل؛ التصحيحات تتم من لوحة الإدارة وتكتب سجلاً في `surveyResponseRevisions`.

## سلوك صفحة الفرع وحارس المسارات

1. استخرج `branchId` من تسجيل الدخول الحالي، ولا تستخدم اسم الفرع للبحث عن الإجابة.
2. اجلب استبيانات `active`، ثم صفِّها بحسب الفروع المستهدفة والمستثناة.
3. احسب التاريخ الحالي بتوقيت الرياض. لكل استبيان احسب آخر `occurrenceDate` مستحق وفق الجدولة الحالية و`scheduleHistory`، مع مراعاة `startDate` و`endDate`.
4. اقرأ وثيقة الإجابة ذات المعرف الثابت. الحالة `draft` أو عدم وجود وثيقة يعني أن الاستبيان غير مكتمل.
5. إذا وُجد استبيان غير مكتمل لهذا الموعد، حوِّل المستخدم إلى صفحة الاستبيانات الإلزامية وامنع كل مسارات الفرع الأخرى عبر Route Guard. استثنِ صفحة الاستبيان نفسها وتسجيل الخروج لتجنب حلقة إعادة توجيه.
6. عند نجاح إرسال جميع المواعيد المطلوبة انتقل إلى المسار الذي طلبه الفرع أو إلى لوحة الفرع. عند فشل التحقق من Firestore اعرض خطأ وإعادة محاولة؛ لا تعتبر الفشل اكتمالاً.
7. يحق للفرع حفظ `draft`، لكن لا يفتح بقية النظام إلا بعد `submitted`. بعد الإرسال تعرض الإجابة للقراءة فقط.

عند حفظ المسودة أو الإرسال، احفظ `month` من أول سبعة أحرف في `occurrenceDate`، و`scheduledAt` كتوقيت بداية ذلك اليوم في الرياض، و`createdAt` عند الإنشاء فقط، و`updatedAt` عند كل حفظ، و`submittedAt` و`submittedBy` عند الإرسال فقط. استخدم المعرف الثابت نفسه للتحديث حتى لا تتكرر الإجابة.

الاستبيانات القديمة التي ليس لها `schedule` تُعامل كبداية كل شهر من `startsFrom`. تبقى الإجابات القديمة ذات المعرف `{surveyId}__{branchId}__{YYYY-MM}` مقروءة. عند ترقية استبيان قديم، افحص المعرف القديم فقط إذا كان الموعد هو اليوم الأول من الشهر. يجب عدم إنشاء إجابة جديدة لموعد شهري له إجابة قديمة مرسلة.

أي تعديل للصفحات أو صلاحيات Firestore في تطبيق Angular يجب أن يحافظ على الإلزام حسب الموعد الجديد وعلى صلاحية الفرع بقراءة وكتابة إجاباته فقط. إدارة الاستبيانات والتصحيح والحذف وقراءة إجابات كل الفروع تحتاج صلاحية المدير في قواعد Firestore المنشورة.
