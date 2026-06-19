import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, doc, setDoc, getDoc, getDocs, updateDoc, onSnapshot,
  deleteField, deleteDoc, collection, addDoc, serverTimestamp, increment, query, where,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { FIREBASE_CONFIG } from '../firebase-config.js';

export const app  = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db   = getFirestore(app);

// Re-export config so admin.js can create a secondary app instance
export { FIREBASE_CONFIG };

export {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, onAuthStateChanged, signOut,
  doc, setDoc, getDoc, getDocs, updateDoc, onSnapshot,
  deleteField, deleteDoc, collection, addDoc, serverTimestamp, increment, query, where,
};
