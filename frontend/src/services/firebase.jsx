import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyD__RGA-YWvuHzNFCtWLkW7st2PaBObJ4w",
    authDomain: "debatenow-aff5f.firebaseapp.com",
    projectId: "debatenow-aff5f",
    storageBucket: "debatenow-aff5f.firebasestorage.app",
    messagingSenderId: "479762070700",
    appId: "1:479762070700:web:3310941bd9f31a7151f309",
    measurementId: "G-ZK0PFRYCFX"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const db = getFirestore(app);