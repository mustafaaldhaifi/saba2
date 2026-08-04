import { db } from "../../config/firebase";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  writeBatch
} from "firebase/firestore";

const COLLECTION_NAME = "column_constraints";

export const generateQuotaGroupId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// الاستماع للبيانات بشكل لحظي (Realtime)
export const subscribeToConstraints = (callback) => {
  const q = query(collection(db, COLLECTION_NAME), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));
      callback(data);
    },
    (error) => {
      console.error("Firestore error:", error);
    }
  );
};

// إضافة قيد جديد
export const addConstraint = async (constraintData) => {
  return await addDoc(collection(db, COLLECTION_NAME), {
    ...constraintData,
    createdAt: serverTimestamp()
  });
};

// تعديل قيد حالي
export const updateConstraint = async (id, constraintData) => {
  const docRef = doc(db, COLLECTION_NAME, id);
  return await updateDoc(docRef, {
    ...constraintData,
    updatedAt: serverTimestamp()
  });
};

// حذف قيد
export const deleteConstraint = async (id) => {
  const docRef = doc(db, COLLECTION_NAME, id);
  return await deleteDoc(docRef);
};

// إضافة مجموعة حصة أسبوعية — document منفصل لكل فرع
export const addWeeklyQuotaGroup = async (documents) => {
  const batch = writeBatch(db);
  const colRef = collection(db, COLLECTION_NAME);

  documents.forEach((docData) => {
    const newRef = doc(colRef);
    batch.set(newRef, {
      ...docData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });

  await batch.commit();
};

// تحديث مجموعة حصة أسبوعية (إنشاء/تعديل/حذف حسب الفروع)
export const saveWeeklyQuotaGroup = async (documents, existingDocs = []) => {
  const batch = writeBatch(db);
  const colRef = collection(db, COLLECTION_NAME);
  const existingByBranch = Object.fromEntries(
    existingDocs.map((d) => [d.branchId, d])
  );
  const newBranchIds = new Set(documents.map((d) => d.branchId));

  documents.forEach((docData) => {
    const existing = existingByBranch[docData.branchId];
    if (existing?.id) {
      batch.update(doc(db, COLLECTION_NAME, existing.id), {
        ...docData,
        updatedAt: serverTimestamp()
      });
    } else {
      batch.set(doc(colRef), {
        ...docData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
  });

  existingDocs.forEach((existing) => {
    if (!newBranchIds.has(existing.branchId)) {
      batch.delete(doc(db, COLLECTION_NAME, existing.id));
    }
  });

  await batch.commit();
};

// حذف جميع documents المرتبطة بمجموعة حصة أسبوعية
export const deleteWeeklyQuotaGroup = async (groupDocs) => {
  const batch = writeBatch(db);
  groupDocs.forEach((d) => {
    if (d.id) {
      batch.delete(doc(db, COLLECTION_NAME, d.id));
    }
  });
  await batch.commit();
};