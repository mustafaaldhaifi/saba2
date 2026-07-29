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
  orderBy
} from "firebase/firestore";

const COLLECTION_NAME = "column_constraints";

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