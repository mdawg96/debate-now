import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword} from "firebase/auth";

// Use the same Firebase configuration as in the frontend
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


// Initialize Firebase Authentication and get a reference to the service
const auth = getAuth(app);

// Example user authentication functions
export const signInUser = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return { success: true, user: userCredential.user };
  } catch (error) {
    return { success: false, error: { code: error.code, message: error.message } };
  }
};

export const createUser = async (email, password) => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    return { success: true, user: userCredential.user };
  } catch (error) {
    return { success: false, error: { code: error.code, message: error.message } };
  }
};