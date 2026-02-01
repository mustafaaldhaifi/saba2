import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyB1JIHjEMIAKzGvKN4Bl83TdUlA2pvt7n4",
  authDomain: "saba-613a2.firebaseapp.com",
  projectId: "saba-613a2",
  storageBucket: "saba-613a2.firebasestorage.app",
  messagingSenderId: "363471585284",
  appId: "1:363471585284:web:84cd496e9a88705664b551",
  measurementId: "G-EDDDHLJC1L"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const environment = {
    production: false,
    version: "7.8",
    enabledDaily: true,
};
