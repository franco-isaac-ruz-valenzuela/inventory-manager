import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Verificamos si la clave tiene formato válido de Firebase para evitar fallos durante el build
const rawApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const isValidKey = rawApiKey && rawApiKey.startsWith("AIzaSy");

const firebaseConfig = {
  apiKey: isValidKey ? rawApiKey : "AIzaSyDummyKeyForVercelBuildSafePrerendering012",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "leker-inventario.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "leker-inventario",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "leker-inventario.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "142689209132",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:142689209132:web:c8412dcce68e9cbb1bba89",
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app);
export const auth = getAuth(app);
export default app;
