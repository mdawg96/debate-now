import './Home.css'
import { useState, useEffect } from 'react';
import { loginUser, registerUser } from '../../services/authService.jsx';
import { auth, db } from '../../services/firebase.jsx';
import { collection, addDoc, query, where, onSnapshot, deleteDoc, doc, getDocs, runTransaction, serverTimestamp, limit, updateDoc, getDoc, setDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { getUserStats } from '../../services/statsService';
import { fixMissingUsernames } from '../../services/userNameFix';

function LeaderboardButton() {
    const navigate = useNavigate();
    
    return (
        <button 
            className="leaderboardButton" 
            onClick={() => navigate('/leaderboard')}
        >
            Leaderboard
        </button>
    );
}

function LoginButton({ user }) {
    const [showForm, setShowForm] = useState(false);
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [username, setUsername] = useState('');
    const [acceptedTerms, setAcceptedTerms] = useState(false);
    const [isOver13, setIsOver13] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (!isLogin) {
                // Registration validation
                if (!acceptedTerms) {
                    alert("You must accept the Terms of Service and Privacy Policy to register.");
                    return;
                }
                if (!isOver13) {
                    alert("You must be 13 years or older to use this service.");
                    return;
                }
            }
            
            if (isLogin) {
                await loginUser(email, password);
                setShowForm(false);
                setEmail('');
                setPassword('');
            } else {
                await registerUser(email, password, username);
                alert(`Account created with username "${username}"! Please check your email for a verification link before logging in.`);
                setIsLogin(true);
                setPassword('');
                setUsername('');
            }
        } catch (error) {
            console.error("Auth error:", error.message);
            alert(error.message);
        }
    };

    return (
        <>
            <button 
                className="logInButton" 
                onClick={() => setShowForm(true)}
            >
                {user ? user.displayName : 'Login'}
            </button>

            {showForm && (
                <div className="loginBox show">
                    <button 
                        className="closeButton"
                        onClick={() => {
                            setShowForm(false);
                            setEmail('');
                            setPassword('');
                            setUsername('');
                            setAcceptedTerms(false);
                            setIsOver13(false);
                        }}
                    >
                        ×
                    </button>
                    <form onSubmit={handleSubmit}>
                        <div className="formHeader">
                            {isLogin ? 'Login' : 'Sign Up'}
                        </div>
                        {!isLogin && (
                            <>
                                <input
                                    type="text"
                                    placeholder="Username"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    required
                                />
                                <div className="legal-requirements">
                                    <label className="checkbox-label">
                                        <input
                                            type="checkbox"
                                            checked={isOver13}
                                            onChange={(e) => setIsOver13(e.target.checked)}
                                            required
                                        />
                                        I confirm that I am 13 years or older
                                    </label>
                                    <label className="checkbox-label">
                                        <input
                                            type="checkbox"
                                            checked={acceptedTerms}
                                            onChange={(e) => setAcceptedTerms(e.target.checked)}
                                            required
                                        />
                                        I accept the <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
                                    </label>
                                </div>
                            </>
                        )}
                        <input
                            type="email"
                            placeholder="Email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                        />
                        <input
                            type="password"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            autoComplete="current-password"
                        />
                        <div className="buttonContainer">
                            <button type="submit" className="submitButton">
                                {isLogin ? 'Login' : 'Sign Up'}
                            </button>
                            <button 
                                type="button" 
                                className="switchButton"
                                onClick={() => {
                                    setIsLogin(!isLogin);
                                    setAcceptedTerms(false);
                                    setIsOver13(false);
                                }}
                            >
                                {isLogin ? 'No Account? Sign up' : 'Go to Login'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </>
    );
}

function Home() {
    const [wins, setWins] = useState(0);
    const [losses, setLosses] = useState(0);
    const [streak, setStreak] = useState(0);
    const [user, setUser] = useState(null);
    const [inQueue, setInQueue] = useState(false);
    const [queueCharacter, setQueueCharacter] = useState(null);
    const [queueDocRef, setQueueDocRef] = useState(null);
    const [matchCreationInProgress, setMatchCreationInProgress] = useState(false);
    const navigate = useNavigate();

    // Load user data including authentication status
    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
            setUser(user);
            
            // Load user stats when user is authenticated
            if (user) {
                loadUserStats(user.uid);
                
                // Ensure user's displayName is up to date
                if (user.displayName) {
                    updateUserDisplayName(user.uid, user.displayName);
                }
                
                // Clear any stale data for this user
                const clearStaleData = async () => {
                    try {
                        // 1. Find all queue entries for this user
                        const queueQuery = query(
                            collection(db, 'queue'),
                            where('userId', '==', user.uid)
                        );
                        
                        const queueSnapshot = await getDocs(queueQuery);
                        
                        // Delete all queue entries
                        const queueDeletePromises = [];
                        for (const doc of queueSnapshot.docs) {
                            try {
                                // Individual try/catch for each deletion to prevent one failure from stopping others
                                queueDeletePromises.push(deleteDoc(doc.ref));
                            } catch (err) {
                                console.error(`Failed to delete queue entry ${doc.id}:`, err);
                            }
                        }
                        
                        if (queueDeletePromises.length > 0) {
                            await Promise.allSettled(queueDeletePromises);
                            console.log(`Cleaned up ${queueDeletePromises.length} stale queue entries`);
                        }
                        
                        // 2. Find all active matches where this user is a participant
                        const initiatorMatchesQuery = query(
                            collection(db, 'matches'),
                            where('initiator', '==', user.uid),
                            where('active', '==', true)
                        );
                        
                        const receiverMatchesQuery = query(
                            collection(db, 'matches'),
                            where('receiver', '==', user.uid),
                            where('active', '==', true)
                        );
                        
                        const [initiatorSnap, receiverSnap] = await Promise.all([
                            getDocs(initiatorMatchesQuery),
                            getDocs(receiverMatchesQuery)
                        ]);
                        
                        // Mark all these matches as inactive
                        const matchUpdatePromises = [];
                        const allDocs = [...initiatorSnap.docs, ...receiverSnap.docs];
                        
                        for (const doc of allDocs) {
                            try {
                                matchUpdatePromises.push(
                                    updateDoc(doc.ref, {
                                        active: false,
                                        cleanedUp: true,
                                        endedAt: serverTimestamp()
                                    })
                                );
                            } catch (err) {
                                console.error(`Failed to update match ${doc.id}:`, err);
                            }
                        }
                        
                        if (matchUpdatePromises.length > 0) {
                            await Promise.allSettled(matchUpdatePromises);
                            console.log(`Cleaned up ${matchUpdatePromises.length} stale match documents`);
                        }
                        
                    } catch (error) {
                        console.error('Error cleaning up stale data:', error);
                    }
                };
                
                clearStaleData();
            } else {
                // Reset stats for non-authenticated users
                setWins(0);
                setLosses(0);
                setStreak(0);
            }
        });

        return () => unsubscribe();
    }, []);
    
    // Fix missing usernames when a user is logged in
    useEffect(() => {
        if (user) {
            fixMissingUsernames()
                .then(result => {
                    console.log("Username fix complete:", result);
                })
                .catch(error => {
                    console.error("Error fixing usernames:", error);
                });
        }
    }, [user]); // Only run when user changes
    
    // Load user stats from Firestore
    const loadUserStats = async (userId) => {
        try {
            const stats = await getUserStats(userId);
            setWins(stats.wins || 0);
            setLosses(stats.losses || 0);
            setStreak(stats.streak || 0);
        } catch (error) {
            console.error('Error loading user stats:', error);
        }
    };

    // Function to update user's displayName in userStats
    const updateUserDisplayName = async (userId, displayName) => {
        try {
            const userStatsRef = doc(db, 'userStats', userId);
            const statsDoc = await getDoc(userStatsRef);
            
            if (statsDoc.exists()) {
                // Only update if the displayName is different or missing
                const currentData = statsDoc.data();
                if (!currentData.displayName || currentData.displayName !== displayName) {
                    await updateDoc(userStatsRef, { displayName });
                    console.log(`Updated displayName in userStats to: ${displayName}`);
                }
            }
            
            // Also ensure the users collection is updated
            await setDoc(doc(db, 'users', userId), {
                displayName,
                updatedAt: new Date().toISOString()
            }, { merge: true });
        } catch (error) {
            console.error("Error updating user displayName:", error);
        }
    };

    // Define character matchups
    const characterMatchups = {
        'Kamala': 'Trump',
        'Trump': 'Kamala',
        'Drake': 'Kendrick',
        'Kendrick': 'Drake',
        'Luka': 'Steph',
        'Steph': 'Luka'
    };

    // Update your queue listening logic to prevent race conditions
    useEffect(() => {
        if (!inQueue || !user || !queueCharacter || matchCreationInProgress) return;

        const opponentCharacter = characterMatchups[queueCharacter];
        console.log(`Looking for opponent with character: ${opponentCharacter}`);
        
        // First, ensure we still have our queue entry
        const verifyAndGetQueueRef = async () => {
            // If we don't have the queueDocRef, try to find it
            if (!queueDocRef) {
                try {
                    console.log("queueDocRef missing, attempting to recover...");
                    const userQueueQuery = query(
                        collection(db, 'queue'),
                        where('userId', '==', user.uid),
                        where('character', '==', queueCharacter)
                    );
                    
                    const snapshot = await getDocs(userQueueQuery);
                    if (!snapshot.empty) {
                        const queueDoc = snapshot.docs[0];
                        console.log("Recovered queue reference:", queueDoc.id);
                        setQueueDocRef({ id: queueDoc.id });
                    } else {
                        console.log("User not found in queue, removing from queue state");
                        setInQueue(false);
                        setQueueCharacter(null);
                        return false;
                    }
                } catch (error) {
                    console.error("Error recovering queue reference:", error);
                    return false;
                }
            }
            return true;
        };
        
        // Before setting up listener, make sure we're actually in queue
        verifyAndGetQueueRef();
        
        const q = query(
            collection(db, 'queue'),
            where('character', '==', opponentCharacter)
        );

        const unsubscribe = onSnapshot(q, async (snapshot) => {
            if (!snapshot.empty && inQueue && !matchCreationInProgress) {
                // More carefully filter opponents to make sure we're not matching with ourselves
                const matchingOpponents = snapshot.docs.filter(doc => {
                    const opponentData = doc.data();
                    // Ensure opponent is different from current user
                    return opponentData.userId !== user.uid;
                });
                
                console.log(`Found ${matchingOpponents.length} potential opponents with character: ${opponentCharacter}`);
                
                if (matchingOpponents.length > 0) {
                    const opponentDoc = matchingOpponents[0];
                    const opponentData = opponentDoc.data();
                    
                    // Double-check it's not the same user (shouldn't happen, but let's be safe)
                    if (opponentData.userId === user.uid) {
                        console.log("Warning: Tried to match with self, ignoring");
                        return;
                    }
                    
                    console.log('Found opponent:', opponentData.username, 'with ID:', opponentData.userId);
                    
                    // Verify we still have our queue entry before starting match process
                    const isInQueue = await verifyAndGetQueueRef();
                    if (!isInQueue) {
                        console.log("Can't create match - we're no longer in queue");
                        return;
                    }
                    
                    try {
                        // Set flag to prevent multiple match creation attempts
                        setMatchCreationInProgress(true);
                        
                        // Check if either user is already in a match before starting the transaction
                        const userMatchesQuery = query(
                            collection(db, 'matches'),
                            where('active', '==', true),
                            where(
                                'initiator', '==', user.uid
                            )
                        );
                        
                        const userMatchesReceiverQuery = query(
                            collection(db, 'matches'),
                            where('active', '==', true),
                            where(
                                'receiver', '==', user.uid
                            )
                        );
                        
                        const opponentInitiatorQuery = query(
                            collection(db, 'matches'),
                            where('active', '==', true),
                            where(
                                'initiator', '==', opponentData.userId
                            )
                        );
                        
                        const opponentReceiverQuery = query(
                            collection(db, 'matches'),
                            where('active', '==', true),
                            where(
                                'receiver', '==', opponentData.userId
                            )
                        );
                        
                        const [userMatches, userMatchesReceiver, opponentInitiator, opponentReceiver] = await Promise.all([
                            getDocs(userMatchesQuery),
                            getDocs(userMatchesReceiverQuery),
                            getDocs(opponentInitiatorQuery),
                            getDocs(opponentReceiverQuery)
                        ]);
                        
                        if (!userMatches.empty || !userMatchesReceiver.empty) {
                            console.log("User already in a match, aborting match creation");
                            setMatchCreationInProgress(false);
                            return;
                        }
                        
                        if (!opponentInitiator.empty || !opponentReceiver.empty) {
                            console.log("Opponent already in a match, aborting match creation");
                            setMatchCreationInProgress(false);
                            return;
                        }
                        
                        // IMPORTANT: Modified transaction handling
                        let matchId = null;
                        try {
                            await runTransaction(db, async (transaction) => {
                                // Check if opponent is still in queue
                                const opponentRef = doc(db, 'queue', opponentDoc.id);
                                const opponentSnapshot = await transaction.get(opponentRef);
                                
                                if (!opponentSnapshot.exists()) {
                                    console.log("Opponent no longer in queue, aborting match");
                                    throw new Error("Opponent already matched");
                                }
                                
                                // Check if user's queue document reference is valid
                                console.log("Using queueDocRef:", queueDocRef.id);
                                
                                const userQueueRef = doc(db, 'queue', queueDocRef.id);
                                const userSnapshot = await transaction.get(userQueueRef);
                                
                                if (!userSnapshot.exists()) {
                                    console.log("User no longer in queue, aborting match");
                                    throw new Error("User not in queue");
                                }
                                
                                // One more check to ensure we're not matching with ourselves
                                const opponentData = opponentSnapshot.data();
                                if (opponentData.userId === user.uid) {
                                    console.log("Attempted to match with self during transaction, aborting");
                                    throw new Error("Cannot match with self");
                                }
                                
                                // Verify user data
                                const userData = userSnapshot.data();
                                console.log("User queue data:", userData);
                                
                                // Determine initiator/receiver roles consistently
                                const isUserInitiator = user.uid < opponentData.userId;
                                
                                // Create match document
                                const matchRef = doc(collection(db, 'matches'));
                                transaction.set(matchRef, {
                                    initiator: isUserInitiator ? user.uid : opponentData.userId,
                                    receiver: isUserInitiator ? opponentData.userId : user.uid,
                                    initiatorCharacter: isUserInitiator ? queueCharacter : opponentData.character,
                                    receiverCharacter: isUserInitiator ? opponentData.character : queueCharacter,
                                    createdAt: serverTimestamp(),
                                    active: true,
                                    matchId: matchRef.id
                                });
                                
                                try {
                                    // Remove both users from queue
                                    // If these fail with "document update time mismatch", the transaction will retry
                                    transaction.delete(userQueueRef);
                                    transaction.delete(opponentRef);
                                } catch (deleteError) {
                                    console.error("Error deleting queue entries:", deleteError);
                                    // Still try to continue with match creation
                                }
                                
                                matchId = matchRef.id;
                            });
                            
                            if (matchId) {
                                console.log('Match created successfully:', matchId);
                                
                                // Important: Wait a short time to ensure Firestore updates are processed
                                // This helps the other client detect the match creation
                                await new Promise(resolve => setTimeout(resolve, 500));
                                
                                // Reset queue state BEFORE navigation
                                setInQueue(false);
                                setQueueCharacter(null);
                                setQueueDocRef(null);
                                
                                // Test Firestore connectivity before navigating
                                const canProceed = await testFirestoreConnectivityBeforeCall(matchId);
                                if (canProceed) {
                                    // Navigate immediately 
                                    navigate(`/call/${matchId}`);
                                } else {
                                    alert("Cannot navigate to the debate room due to connection issues. Please check your connection and try again.");
                                }
                            }
                        } catch (transactionError) {
                            if (transactionError.message === "Opponent already matched" || 
                                transactionError.message === "User not in queue" ||
                                transactionError.message === "Cannot match with self") {
                                console.log("Expected error in match creation:", transactionError.message);
                                // This is an expected error, no need to alert
                                
                                // Try to clean up our queue entry to prevent orphaned entries
                                try {
                                    if (queueDocRef) {
                                        // Create a proper doc reference using the stored ID
                                        const docRef = doc(db, 'queue', queueDocRef.id);
                                        await deleteDoc(docRef);
                                        console.log("Cleaned up user's queue entry after match creation failure");
                                        // Reset queue state since we're no longer in queue
                                        setInQueue(false);
                                        setQueueCharacter(null);
                                        setQueueDocRef(null);
                                    }
                                } catch (cleanupError) {
                                    console.error("Failed to clean up queue entry:", cleanupError);
                                }
                            } else {
                                console.error('Error in match creation transaction:', transactionError);
                            }
                            // Reset the match creation flag
                            setMatchCreationInProgress(false);
                        }
                    } catch (outerError) {
                        console.error('Outer error in match handling:', outerError);
                        // Reset the match creation flag
                        setMatchCreationInProgress(false);
                    }
                }
            }
        });
        
        return () => unsubscribe();
    }, [inQueue, user, queueCharacter, queueDocRef, navigate, characterMatchups, matchCreationInProgress]);

    // Also listen for matches where this user is a participant
    useEffect(() => {
        // Only listen for matches if the user is logged in AND actively in queue
        if (!user || !inQueue || !queueCharacter) return;
        
        console.log("Setting up match listener for user:", user.uid, "with character:", queueCharacter);
        
        // Listen for matches where user is either initiator or receiver
        const matchesQuery = query(
            collection(db, 'matches'),
            where('active', '==', true),
            where('initiator', '==', user.uid)
        );
        
        const unsubscribe = onSnapshot(matchesQuery, async (snapshot) => {
            // Double-check we're still in queue before processing matches
            if (inQueue && queueCharacter) {
                const initiatorMatches = snapshot.docs;
                
                if (initiatorMatches.length > 0) {
                    const matchDoc = initiatorMatches[0];
                    const matchData = matchDoc.data();
                    
                    // Make sure we have a valid matchId - either from the data or from the document ID
                    const matchId = matchData.matchId || matchDoc.id;
                    
                    console.log('Found match where user is initiator:', matchId);
                    
                    if (matchId) {
                        // Reset queue state
                        setInQueue(false);
                        setQueueCharacter(null);
                        setQueueDocRef(null);
                        setMatchCreationInProgress(false);
                        
                        // Test Firestore connectivity before navigating
                        const canProceed = await testFirestoreConnectivityBeforeCall(matchId);
                        if (canProceed) {
                            // Navigate to call with the valid matchId
                            navigate(`/call/${matchId}`);
                        } else {
                            alert("Cannot navigate to the debate room due to connection issues. Please check your connection and try again.");
                        }
                    }
                }
            }
        });
        
        // Second query for matches where user is receiver
        const receiverMatchesQuery = query(
            collection(db, 'matches'),
            where('active', '==', true),
            where('receiver', '==', user.uid)
        );
        
        const receiverUnsubscribe = onSnapshot(receiverMatchesQuery, async (snapshot) => {
            // Double-check we're still in queue before processing matches
            if (inQueue && queueCharacter) {
                const receiverMatches = snapshot.docs;
                
                if (receiverMatches.length > 0) {
                    const matchDoc = receiverMatches[0];
                    const matchData = matchDoc.data();
                    
                    // Make sure we have a valid matchId - either from the data or from the document ID
                    const matchId = matchData.matchId || matchDoc.id;
                    
                    console.log('Found match where user is receiver:', matchId);
                    
                    if (matchId) {
                        // Reset queue state
                        setInQueue(false);
                        setQueueCharacter(null);
                        setQueueDocRef(null);
                        setMatchCreationInProgress(false);
                        
                        // Test Firestore connectivity before navigating
                        const canProceed = await testFirestoreConnectivityBeforeCall(matchId);
                        if (canProceed) {
                            // Navigate to call with the valid matchId
                            navigate(`/call/${matchId}`);
                        } else {
                            alert("Cannot navigate to the debate room due to connection issues. Please check your connection and try again.");
                        }
                    }
                }
            }
        });
        
        return () => {
            unsubscribe();
            receiverUnsubscribe();
        };
    }, [user, inQueue, navigate, queueCharacter]);

    const handleCharacterSelect = async (character) => {
        if (!user) {
            alert("Please login first!");
            return;
        }
        
        try {
            // First, check if there are any existing queue entries for this user
            const existingQueueQuery = query(
                collection(db, 'queue'),
                where('userId', '==', user.uid)
            );
            
            const existingQueueSnap = await getDocs(existingQueueQuery);
            if (!existingQueueSnap.empty) {
                // Clean up any existing queue entries
                const deletePromises = existingQueueSnap.docs.map(doc => 
                    deleteDoc(doc.ref)
                );
                await Promise.all(deletePromises);
                console.log(`Cleaned up ${deletePromises.length} existing queue entries before adding new one`);
            }
            
            // Add user to queue in Firestore
            const queueRef = await addDoc(collection(db, 'queue'), {
                userId: user.uid,
                character: character,
                username: user.displayName,
                joinedAt: new Date()
            });
            
            // Save reference to queue document for later removal
            // Store only the ID to avoid serialization issues
            setQueueDocRef({ id: queueRef.id });
            setInQueue(true);
            setQueueCharacter(character);
            
            console.log(`Added to queue as ${character} with queue ID: ${queueRef.id}`);
        } catch (error) {
            console.error('Error joining queue:', error);
            alert('Error joining queue. Please try again.');
        }
    };

    const handleLeaveQueue = async () => {
        if (queueDocRef) {
            try {
                // Create a proper doc reference using the stored ID
                const docRef = doc(db, 'queue', queueDocRef.id);
                await deleteDoc(docRef);
                console.log('Removed from queue');
            } catch (error) {
                console.error('Error leaving queue:', error);
            }
        }
        
        setInQueue(false);
        setQueueCharacter(null);
        setQueueDocRef(null);
    };

    useEffect(() => {
        const testFirestoreConnection = async () => {
            try {
                // Try to access Firestore
                const testRef = collection(db, 'test_connection');
                await getDocs(query(testRef, limit(1)));
            } catch (error) {
                if (error.code === 'failed-precondition' || 
                    error.message.includes('blocked') || 
                    error.message.includes('network error')) {
                    alert('Firebase connection is being blocked. Please disable ad blockers or privacy extensions for this site.');
                }
            }
        };
        
        testFirestoreConnection();
    }, []);

    // Add a function to manually refresh queue status
    const refreshQueueStatus = async () => {
        if (!user) return;
        
        try {
            // Check if user is still in queue
            const userQueueQuery = query(
                collection(db, 'queue'),
                where('userId', '==', user.uid)
            );
            
            const snapshot = await getDocs(userQueueQuery);
            
            if (snapshot.empty && inQueue) {
                console.log("Queue status inconsistent - user thinks they're in queue but aren't. Resetting state.");
                setInQueue(false);
                setQueueCharacter(null);
                setQueueDocRef(null);
                alert("Your queue entry was not found. Please try again.");
            } else if (!snapshot.empty) {
                const queueDoc = snapshot.docs[0];
                const queueData = queueDoc.data();
                console.log("Queue entry found:", queueDoc.id, queueData);
                
                // Update state with latest data
                setQueueDocRef({ id: queueDoc.id });
                setQueueCharacter(queueData.character);
                setInQueue(true);
            }
        } catch (error) {
            console.error("Error refreshing queue status:", error);
        }
    };

    // Add after refreshQueueStatus function
    const testFirestoreConnectivityBeforeCall = async (matchId) => {
        try {
            console.log("Testing Firestore connectivity before navigating to call page...");
            
            // Try to write to a test document
            const testDocRef = doc(db, "connectivity_tests", `test_${Date.now()}`);
            await setDoc(testDocRef, {
                timestamp: serverTimestamp(),
                userId: user?.uid || "anonymous",
                userAgent: navigator.userAgent
            });
            
            console.log("Firestore connectivity test passed, proceeding to call page");
            return true;
        } catch (error) {
            console.error("Firestore connectivity test failed:", error);
            
            // Check if the error is related to blocking
            if (error.message && (
                error.message.includes("network error") || 
                error.message.includes("Failed to fetch") ||
                error.message.includes("blocked") ||
                error.code === "failed-precondition" ||
                error.code === "unavailable") ||
                error.message.includes("quota exceeded") ||
                error.message.includes("permission_denied")
            ) {
                // Show a brief warning but don't block navigation
                alert("Ad blocker detected. Some features may not work properly. For the best experience, please disable your ad blocker.");
            } else {
                // For other types of errors, also show a message but don't block
                console.warn("Connection issue detected, but allowing navigation anyway");
            }
            
            // Always return true to allow navigation regardless of connectivity issues
            return true;
        }
    };

    return(
        <>
            <div className="top-buttons">
                <LeaderboardButton />
                <LoginButton user={user} />
            </div>
            <h1 className="title">Debate<br/>Now</h1>
            <div className="playButtons">
                <div className="blueButtons">
                    <button 
                        className="kamalaButton"
                        onClick={() => handleCharacterSelect('Kamala')}
                        disabled={inQueue}
                    >
                        Kamala
                    </button>
                    <button 
                        className="messiButton"
                        onClick={() => handleCharacterSelect('Drake')}
                        disabled={inQueue}
                    >
                        Drake
                    </button>
                    <button 
                        className="tiktokButton"
                        onClick={() => handleCharacterSelect('Luka')}
                        disabled={inQueue}
                    >
                        Luka
                    </button>
                </div>
                <div className="redButtons">
                    <button 
                        className="trumpButton"
                        onClick={() => handleCharacterSelect('Trump')}
                        disabled={inQueue}
                    >
                        Trump
                    </button>
                    <button 
                        className="ronaldoButton"
                        onClick={() => handleCharacterSelect('Kendrick')}
                        disabled={inQueue}
                    >
                        Kendrick
                    </button>
                    <button 
                        className="reelsButton"
                        onClick={() => handleCharacterSelect('Steph')}
                        disabled={inQueue}
                    >
                        Steph
                    </button>
                </div>
            </div>  
            <h2 className="Tracker">{wins} W | {losses} L | {streak} S </h2>    
            
            {inQueue && (
                <div className="queue-status">
                    <p>Waiting in queue as {queueCharacter}...</p>
                    <div className="queue-info">
                        {queueDocRef && <p className="queue-id">Queue ID: {queueDocRef.id}</p>}
                    </div>
                    <div className="queue-buttons">
                        <button 
                            className="refresh-queue-button"
                            onClick={refreshQueueStatus}
                        >
                            Refresh Queue Status
                        </button>
                        <button 
                            className="leave-queue-button"
                            onClick={handleLeaveQueue}
                        >
                            Leave Queue
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

export default Home;