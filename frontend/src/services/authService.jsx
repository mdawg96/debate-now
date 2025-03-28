import { auth, db } from './firebase.jsx';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    sendEmailVerification,
    updateProfile 
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";

const loginUser = async (email, password) => {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    if (!userCredential.user.emailVerified) {
        throw new Error('Please verify your email before logging in. Check your inbox for the verification link.');
    }
    return userCredential;
};

const registerUser = async (email, password, username) => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    
    // Set the username first
    await updateProfile(userCredential.user, {
        displayName: username
    });
    
    // Also store the user data in Firestore for better accessibility
    try {
        await setDoc(doc(db, 'users', userCredential.user.uid), {
            displayName: username,
            email: email,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        console.log("User document created in Firestore");
    } catch (error) {
        console.error("Error creating user document:", error);
        // Continue even if this fails - auth still works
    }
    
    // Then send verification email
    await sendEmailVerification(userCredential.user);
    
    // Sign out the user until they verify their email
    await auth.signOut();
    
    return userCredential;
};

export { loginUser, registerUser };


