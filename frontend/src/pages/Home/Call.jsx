import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { auth, db } from "../../services/firebase.jsx";
import {
  doc,
  getDoc,
  updateDoc,
  onSnapshot,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  getDocs,
  setDoc,
  limit
} from "firebase/firestore";
import { servers } from "../../services/signalserver";
import { createTranscriptionService } from "../../services/transcriptionService";
import DebateJudge from "../../components/DebateJudge";
import ChatBox from "../../components/ChatBox";
import './Call.css';
import { updateUserStats } from '../../services/statsService';

// Define debate stages and their durations in seconds
const DEBATE_STAGES = [
  { name: "First Speaker", duration: 45, whoSpeaks: "initiator" },
  { name: "Second Speaker", duration: 45, whoSpeaks: "receiver" },
  { name: "Open Discussion", duration: 300, whoSpeaks: "both" },
  { name: "First Speaker Closing", duration: 45, whoSpeaks: "initiator" },
  { name: "Second Speaker Closing", duration: 45, whoSpeaks: "receiver" },
  { name: "Debate Ended", duration: 0, whoSpeaks: "none" }
];

// Maximum percentage one person can talk during open discussion before penalty
const MAX_OPEN_DISCUSSION_DOMINANCE = 0.75; // 75%

// Warning threshold when approaching dominance limit
const DOMINANCE_WARNING_THRESHOLD = 0.65; // 65%

// Add these constants at the top of the file with other constants
const DISCONNECT_TIMEOUT = 15000; // 15 seconds before considering user disconnected
const DEBATE_FORFEIT_MESSAGE = "Your opponent has disconnected. You win by forfeit.";
const DEBATE_RECONNECT_MESSAGE = "This debate has already ended due to your disconnection. You cannot rejoin.";

function Call() {
    const { matchId } = useParams();
    const navigate = useNavigate();
    
    const [matchData, setMatchData] = useState(null);
    const [isInitiator, setIsInitiator] = useState(false);
    const [isConnecting, setIsConnecting] = useState(true);
    const [isConnected, setIsConnected] = useState(false);
    const [user, setUser] = useState(null);
    const [matchError, setMatchError] = useState(null);
    const [retryCount, setRetryCount] = useState(0);
    const [adBlockerDetected, setAdBlockerDetected] = useState(false);
    const [showAdBlockBanner, setShowAdBlockBanner] = useState(false);
    
    // Video refs and states
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const [localStream, setLocalStream] = useState(null);
    const [remoteStream] = useState(new MediaStream());
    
    // WebRTC connection refs
    const peerConnectionRef = useRef(null);
    const localStreamRef = useRef(null);
    const connectionSetupDoneRef = useRef(false);
    
    const [connectionStatus, setConnectionStatus] = useState('Initializing');
    const [debugInfo, setDebugInfo] = useState({});
    
    // Debate timer states
    const [debateStarted, setDebateStarted] = useState(false);
    const [currentStageIndex, setCurrentStageIndex] = useState(0);
    const [timeRemaining, setTimeRemaining] = useState(DEBATE_STAGES[0].duration);
    const [isLocalAudioEnabled, setIsLocalAudioEnabled] = useState(true);
    const timerRef = useRef(null);
    const debateStartTimeRef = useRef(null);
    const stageStartTimeRef = useRef(null);
    
    // Function references to avoid circular dependencies
    const startTimerIntervalRef = useRef(null);
    const moveToNextStageRef = useRef(null);
    const startDebateRef = useRef(null);
    
    // Judge related state
    const [showJudge, setShowJudge] = useState(false);
    const [judgeEvaluationCriteria, setJudgeEvaluationCriteria] = useState(
        "Evaluate based on clarity of arguments, use of evidence, persuasiveness, and addressing opposing points"
    );
    
    // Transcription states
    const [transcriptionEnabled, setTranscriptionEnabled] = useState(false);
    const [localTranscription, setLocalTranscription] = useState("");
    const [remoteTranscription, setRemoteTranscription] = useState("");
    const [localTranscriptHistory, setLocalTranscriptHistory] = useState("");
    const [remoteTranscriptHistory, setRemoteTranscriptHistory] = useState("");
    const transcriptionServiceRef = useRef(null);
    
    // Add a state for chat visibility
    const [isChatVisible, setIsChatVisible] = useState(true);
    
    // Add this state for camera toggle
    const [isCameraEnabled, setIsCameraEnabled] = useState(true);
    
    // Add after the WebRTC connection refs
    const chatChannelRef = useRef(null);
    
    // Add variables to track speaking time during open discussion
    const [openDiscussionStats, setOpenDiscussionStats] = useState({
        initiatorSpeakingTime: 0,
        receiverSpeakingTime: 0,
        lastSpeakingTimestamp: null,
        currentSpeaker: null,
        dominancePenaltyApplied: false
    });
    
    // Add a flag for dominance warning
    const [showDominanceWarning, setShowDominanceWarning] = useState(false);
    
    // Add a new state variable
    const [disconnectionTimer, setDisconnectionTimer] = useState(null);
    
    // Setup authentication listener
    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(currentUser => {
            if (currentUser) {
                setUser(currentUser);
            } else {
                // No user is signed in, redirect to login
                navigate('/');
            }
        });
        
        return () => unsubscribe();
    }, [navigate]);
    
    // Clean up function
    const cleanupResources = () => {
        console.log("Cleaning up WebRTC resources");
        
        // Stop all tracks in local stream
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                track.stop();
            });
            localStreamRef.current = null;
        }
        
        // Close peer connection
        if (peerConnectionRef.current) {
            peerConnectionRef.current.close();
            peerConnectionRef.current = null;
        }
        
        // Clear debate timer if active
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        
        // Clean up transcription resources
        cleanupTranscription();
    };
    
    // Clean up transcription resources
    const cleanupTranscription = () => {
        // Clean up transcription resources
        if (transcriptionServiceRef.current) {
            transcriptionServiceRef.current.cleanup();
        }
    };
    
    // Start transcription for both local and remote streams
    const startTranscription = useCallback(() => {
        // Clean up any existing transcription 
        if (transcriptionServiceRef.current) {
            transcriptionServiceRef.current.cleanup();
        }
        
        // Reset transcription text
        setLocalTranscription("");
        setRemoteTranscription("");
        
        console.log("Starting transcription services...");
        
        // Create transcription service with callbacks
        transcriptionServiceRef.current = createTranscriptionService({
            onLocalTranscription: (transcript) => {
                setLocalTranscription(transcript);
            },
            onRemoteTranscription: (transcript) => {
                setRemoteTranscription(transcript);
            }
        });
        
        // Start the transcription service
        transcriptionServiceRef.current.start(localStream, remoteStream);
    }, [localStream, remoteStream]);
    
    // Function to toggle transcription on/off
    const toggleTranscription = useCallback(() => {
        if (transcriptionEnabled) {
            if (transcriptionServiceRef.current) {
                transcriptionServiceRef.current.cleanup();
            }
            setTranscriptionEnabled(false);
        } else if (isConnected && localStream && remoteStream) {
            startTranscription();
            setTranscriptionEnabled(true);
        } else {
            alert("Cannot start transcription until connected");
        }
    }, [transcriptionEnabled, isConnected, localStream, remoteStream, startTranscription]);
    
    // Function to move to the next debate stage
    const moveToNextStage = useCallback(async () => {
        console.log(`Moving from stage ${currentStageIndex} to ${currentStageIndex + 1}`);
        
        // Clear existing timer
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        
        // If there are more stages, proceed to the next one
        if (currentStageIndex < DEBATE_STAGES.length - 1) {
            const nextIndex = currentStageIndex + 1;
            console.log(`Setting up stage ${nextIndex}: ${DEBATE_STAGES[nextIndex].name}`);
            
            // Update local state
            setCurrentStageIndex(nextIndex);
            setTimeRemaining(DEBATE_STAGES[nextIndex].duration);
            stageStartTimeRef.current = new Date().getTime();
            
            // Only store essential stage data
            await updateDoc(doc(db, 'matches', matchId), {
                debateStage: nextIndex,
                stageStartTime: serverTimestamp()
            });
            
            // Start timer for the next stage
            if (startTimerIntervalRef.current) {
                startTimerIntervalRef.current();
            }
        } else {
            // End of debate - only store final state
            await updateDoc(doc(db, 'matches', matchId), {
                debateEnded: true,
                endedAt: serverTimestamp()
            });
            
            if (transcriptionServiceRef.current) {
                const transcriptionHistory = transcriptionServiceRef.current.getTranscriptionHistory();
                setLocalTranscriptHistory(transcriptionHistory.localTranscriptionHistory || "");
                setRemoteTranscriptHistory(transcriptionHistory.remoteTranscriptionHistory || "");
            }
            
            setShowJudge(true);
        }
    }, [currentStageIndex, matchId]);
    
    // Function to start the timer interval
    const startTimerInterval = useCallback(() => {
        // Clear any existing timer first
        if (timerRef.current) {
            clearInterval(timerRef.current);
            console.log("Cleared existing timer");
        }
        
        // Log current debate stage state for debugging
        console.log(`Starting new timer for stage ${currentStageIndex}: ${DEBATE_STAGES[currentStageIndex].name} (${DEBATE_STAGES[currentStageIndex].duration}s)`);
        console.log(`Current state of debate: ${JSON.stringify({
            currentStageIndex,
            isInitiator,
            debateStarted,
            stageStartTime: new Date(stageStartTimeRef.current).toLocaleTimeString(),
            timeRemaining
        })}`);
        
        // Start a new timer that updates every second
        timerRef.current = setInterval(() => {
            try {
                // Calculate elapsed time in this stage
                const now = new Date().getTime();
                const stageElapsed = Math.floor((now - stageStartTimeRef.current) / 1000);
                const currentStageDuration = DEBATE_STAGES[currentStageIndex].duration;
                const remaining = Math.max(0, currentStageDuration - stageElapsed);
                
                // Only log every 15 seconds to avoid console spam
                if (remaining % 15 === 0 || remaining <= 5) {
                    console.log(`Stage ${currentStageIndex} (${DEBATE_STAGES[currentStageIndex].name}) - ${remaining}s remaining`);
                }
                
                setTimeRemaining(remaining);
                
                // If time is up, move to next stage
                if (remaining <= 0) {
                    console.log(`Time up for stage ${currentStageIndex}! Moving to next stage.`);
                    if (moveToNextStageRef.current) {
                        moveToNextStageRef.current();
                    }
                }
            } catch (error) {
                console.error("Error in timer interval:", error);
            }
        }, 1000);
    }, [currentStageIndex, isInitiator, debateStarted, timeRemaining]);
    
    // Timer control functions
    const startDebate = useCallback(async () => {
        if (debateStarted) return;
        
        const now = new Date().getTime();
        debateStartTimeRef.current = now;
        stageStartTimeRef.current = now;
        
        setDebateStarted(true);
        setCurrentStageIndex(0);
        setTimeRemaining(DEBATE_STAGES[0].duration);
        
        // Only store essential data
        await updateDoc(doc(db, 'matches', matchId), {
            debateStarted: true,
            debateStage: 0,
            stageStartTime: serverTimestamp()
        });
        
        if (startTimerIntervalRef.current) {
            startTimerIntervalRef.current();
        }
        
        if (!transcriptionEnabled && isConnected) {
            toggleTranscription();
        }
    }, [debateStarted, matchId, transcriptionEnabled, isConnected, toggleTranscription]);
    
    // Update refs after definitions
    useEffect(() => {
        startTimerIntervalRef.current = startTimerInterval;
        moveToNextStageRef.current = moveToNextStage;
        startDebateRef.current = startDebate;
    }, [startTimerInterval, moveToNextStage, startDebate]);
    
    // Listen for changes to debate state
    useEffect(() => {
        if (!matchData || !matchId) return;
        
        // If remote user started the debate
        if (matchData.debateStarted && !debateStarted) {
            console.log("Remote user started the debate, syncing local state");
            
            // First set the state flag
            setDebateStarted(true);
            
            // Get server timestamp (converted to client time by Firestore)
            const serverStartTime = matchData.debateStartTime?.toDate();
            if (serverStartTime) {
                debateStartTimeRef.current = serverStartTime.getTime();
                console.log(`Using server start time: ${new Date(debateStartTimeRef.current).toLocaleTimeString()}`);
            } else {
                debateStartTimeRef.current = new Date().getTime();
                console.log("No server start time, using current time");
            }
            
            // Clear any existing timer
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            
            // Get the current stage from the server
            if (matchData.debateStage !== undefined) {
                const serverStage = matchData.debateStage;
                console.log(`Setting to server stage: ${serverStage} (${DEBATE_STAGES[serverStage].name})`);
                setCurrentStageIndex(serverStage);
                
                // Get the stage start time
                const stageStartTime = matchData.stageStartTime?.toDate();
                if (stageStartTime) {
                    stageStartTimeRef.current = stageStartTime.getTime();
                    console.log(`Using server stage start time: ${new Date(stageStartTime).toLocaleTimeString()}`);
                    
                    // Calculate remaining time in this stage
                    const now = new Date().getTime();
                    const stageElapsed = Math.floor((now - stageStartTimeRef.current) / 1000);
                    const stageDuration = DEBATE_STAGES[serverStage].duration;
                    const remaining = Math.max(0, stageDuration - stageElapsed);
                    
                    console.log(`Initial stage timing: elapsed=${stageElapsed}s, duration=${stageDuration}s, remaining=${remaining}s`);
                    setTimeRemaining(remaining);
                } else {
                    console.log("No server stage start time, using current time");
                    stageStartTimeRef.current = new Date().getTime();
                    setTimeRemaining(DEBATE_STAGES[serverStage].duration);
                }
                
                // Start the timer
                if (startTimerIntervalRef.current) {
                    startTimerIntervalRef.current();
                }
            } else {
                console.log("No server stage information, defaulting to stage 0");
                setCurrentStageIndex(0);
                stageStartTimeRef.current = new Date().getTime();
                setTimeRemaining(DEBATE_STAGES[0].duration);
                if (startTimerIntervalRef.current) {
                    startTimerIntervalRef.current();
                }
            }
        }
        
        // If the stage changed remotely
        if (matchData.debateStarted && debateStarted && 
            matchData.debateStage !== undefined && 
            matchData.debateStage !== currentStageIndex) {
            
            console.log(`REMOTE STAGE CHANGE DETECTED: Local=${currentStageIndex}, Remote=${matchData.debateStage}`);
            console.log(`Changing from ${DEBATE_STAGES[currentStageIndex].name} to ${DEBATE_STAGES[matchData.debateStage].name}`);
            console.log(`Speaking permissions changing from ${DEBATE_STAGES[currentStageIndex].whoSpeaks} to ${DEBATE_STAGES[matchData.debateStage].whoSpeaks}`);
            
            // Update the current stage index
            setCurrentStageIndex(matchData.debateStage);
            
            // Get the stage start time
            const stageStartTime = matchData.stageStartTime?.toDate();
            if (stageStartTime) {
                stageStartTimeRef.current = stageStartTime.getTime();
                
                // Calculate remaining time in this stage
                const now = new Date().getTime();
                const stageElapsed = Math.floor((now - stageStartTimeRef.current) / 1000);
                const stageDuration = DEBATE_STAGES[matchData.debateStage].duration;
                const remaining = Math.max(0, stageDuration - stageElapsed);
                
                console.log(`Remote stage timing: elapsed=${stageElapsed}s, duration=${stageDuration}s, remaining=${remaining}s`);
                setTimeRemaining(remaining);
            } else {
                console.log("No remote stage start time available, using current time");
                stageStartTimeRef.current = new Date().getTime();
                setTimeRemaining(DEBATE_STAGES[matchData.debateStage].duration);
            }
            
            // Restart the timer with the new stage
            clearInterval(timerRef.current);
            if (startTimerIntervalRef.current) {
                startTimerIntervalRef.current();
            }
        }
        
        // If debate ended remotely
        if (matchData.debateEnded && timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
            setTimeRemaining(0);
        }
        
    }, [matchData, debateStarted, currentStageIndex, matchId]);
    
    // Control audio based on debate stage
    useEffect(() => {
        if (!debateStarted || !localStream) return;
        
        const currentStage = DEBATE_STAGES[currentStageIndex];
        
        // Determine if this user should be allowed to speak
        let canSpeak = false;
        if (currentStage.whoSpeaks === "both") {
            canSpeak = true;
            console.log("Open discussion stage - both can speak");
        } else if (currentStage.whoSpeaks === "initiator" && isInitiator) {
            canSpeak = true;
            console.log("Initiator's turn - you are the initiator, you can speak");
        } else if (currentStage.whoSpeaks === "receiver" && !isInitiator) {
            canSpeak = true;
            console.log("Receiver's turn - you are the receiver, you can speak");
        } else {
            canSpeak = false;
            console.log(`Current stage (${currentStage.name}) doesn't allow you to speak - you are ${isInitiator ? 'initiator' : 'receiver'}`);
        }
        
        // Mute/unmute audio track based on speaking turn
        const audioTracks = localStream.getAudioTracks();
        console.log(`Setting audio enabled to ${canSpeak} for ${audioTracks.length} tracks`);
        
        audioTracks.forEach(track => {
            const trackWasEnabled = track.enabled;
            track.enabled = canSpeak;
            console.log(`Audio track '${track.label}' changed from ${trackWasEnabled} to ${track.enabled}`);
        });
        
        setIsLocalAudioEnabled(canSpeak);
        
    }, [currentStageIndex, isInitiator, localStream, debateStarted]);
    
    // Function to format time remaining
    const formatTime = (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    };
    
    // Get current stage info
    const getCurrentStage = () => {
        return DEBATE_STAGES[currentStageIndex];
    };

    // Function to log remote tracks
    const logRemoteTracks = () => {
        if (remoteStream) {
            console.log("Remote stream tracks:", [...remoteStream.getTracks()]);
        }
    };
    
    // Update video references when streams change
    useEffect(() => {
        logRemoteTracks();
        
        if (remoteVideoRef.current && remoteStream) {
            remoteVideoRef.current.srcObject = remoteStream;
        }
    }, [remoteStream]);
    
    useEffect(() => {
        if (localVideoRef.current && localStream) {
            localVideoRef.current.srcObject = localStream;
        }
    }, [localStream]);
    
    // Clean up transcription resources on unmount
    useEffect(() => {
        return () => {
            cleanupTranscription();
        };
    }, []);
    
    // Add immediate ad blocker check on component mount, before any other operations
    useEffect(() => {
        const immediateConnectionTest = async () => {
            try {
                console.log("Performing immediate Firestore connectivity test...");
                
                // Try a simple read operation
                const testRef = collection(db, "connectivity_tests");
                const testQuery = query(testRef, limit(1));
                await getDocs(testQuery);
                
                console.log("Initial connectivity test passed");
            } catch (error) {
                console.error("Immediate connection test failed:", error);
                
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
                    setAdBlockerDetected(true);
                    setShowAdBlockBanner(true);
                    
                    // Auto-hide the banner after 10 seconds
                    setTimeout(() => {
                        setShowAdBlockBanner(false);
                    }, 10000);
                }
            }
        };
        
        // Run the immediate connection test
        immediateConnectionTest();
    }, []); // Empty dependency array means this runs once on mount
    
    // Add a function to actively test Firestore connectivity
    const testFirestoreConnectivity = useCallback(async () => {
        try {
            console.log("Testing Firestore connectivity...");
            // Try to write to a test document
            const testDocRef = doc(db, "connectivity_tests", `test_${Date.now()}`);
            await setDoc(testDocRef, {
                timestamp: serverTimestamp(),
                userId: user?.uid || "anonymous",
                userAgent: navigator.userAgent
            });
            console.log("Firestore connectivity test passed");
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
                setAdBlockerDetected(true);
                setShowAdBlockBanner(true);
                
                // Auto-hide the banner after 10 seconds
                setTimeout(() => {
                    setShowAdBlockBanner(false);
                }, 10000);
            }
            // Always return true to allow the application to continue regardless of connectivity
            return true;
        }
    }, [user]);

    // Run connectivity test when user is loaded
    useEffect(() => {
        if (user) {
            testFirestoreConnectivity();
        }
    }, [user, testFirestoreConnectivity]);
    
    // Enhance the useEffect for match data listener to check if user previously disconnected
    useEffect(() => {
        if (!matchId || !user) return;
        
        console.log("Attempting to fetch match data for ID:", matchId);
        
        // First test connectivity (but don't block on failure)
        testFirestoreConnectivity();
        
        // Check if this user previously disconnected from this match
        const checkPreviousDisconnection = async () => {
            try {
                const matchRef = doc(db, 'matches', matchId);
                const matchSnap = await getDoc(matchRef);
                
                if (matchSnap.exists()) {
                    const data = matchSnap.data();
                    
                    // If this user was previously marked as disconnected
                    if (data.disconnectedUser === user.uid) {
                        console.log("This user previously disconnected from this match");
                        setMatchError(DEBATE_RECONNECT_MESSAGE);
                        
                        // Navigate home after a short delay
                        setTimeout(() => navigate('/'), 3000);
                        return true;
                    }
                    
                    // If match is inactive due to other user disconnection, show win message
                    if (!data.active && data.disconnectedUser && data.disconnectedUser !== user.uid) {
                        console.log("Other user disconnected from this match");
                        setMatchError(DEBATE_FORFEIT_MESSAGE);
                        
                        // Navigate home after a short delay
                        setTimeout(() => navigate('/'), 3000);
                        return true;
                    }
                    
                    return false;
                }
                return false;
            } catch (error) {
                console.error("Error checking previous disconnection:", error);
                return false;
            }
        };
        
        checkPreviousDisconnection().then(wasDisconnected => {
            if (wasDisconnected) {
                return; // Don't set up listeners if user previously disconnected
            }
            
            // Set up the listener for match updates
            const matchRef = doc(db, 'matches', matchId);
            
            const unsubscribe = onSnapshot(matchRef, (docSnapshot) => {
                if (docSnapshot.exists()) {
                    const data = docSnapshot.data();
                    console.log("Match data received:", data);
                    
                    // Check if other user disconnected
                    if (!data.active && data.disconnectedUser && data.disconnectedUser !== user.uid) {
                        console.log("Other user disconnected from match");
                        setMatchError(DEBATE_FORFEIT_MESSAGE);
                        
                        // Clear any active debate timer
                        if (timerRef.current) {
                            clearInterval(timerRef.current);
                            timerRef.current = null;
                        }
                        
                        // Navigate home after a short delay
                        setTimeout(() => navigate('/'), 3000);
                        return;
                    }
                    
                    // First set the match data
                    setMatchData(data);
                    
                    if (user) {
                        // Determine if user is initiator or receiver
                        const userIsInitiator = user.uid === data.initiator;
                        console.log("User is initiator:", userIsInitiator);
                        setIsInitiator(userIsInitiator);
                        
                        // IMPORTANT: Delay the setup call to ensure state is updated
                        setTimeout(() => {
                            if (!connectionSetupDoneRef.current) {
                                console.log("Setting up WebRTC with match data:", data);
                                setupCallConnection(data, userIsInitiator);
                            }
                        }, 1000);
                    }
                } else {
                    console.log("Match does not exist or was removed");
                    
                    if (retryCount < 3) {
                        // Wait and try again, as match document might be created with slight delay
                        setTimeout(() => {
                            setRetryCount(prev => prev + 1);
                        }, 1000);
                    } else {
                        setMatchError("Match not found or was removed. Redirecting to home page...");
                        // Maybe navigate home after a delay
                        setTimeout(() => navigate('/'), 3000);
                    }
                }
            }, (error) => {
                console.error("Error listening to match updates:", error);
                
                // Check if the error might be due to ad blockers
                if (error.message && (
                    error.message.includes("network error") || 
                    error.message.includes("Failed to fetch") ||
                    error.message.includes("blocked") ||
                    error.code === "failed-precondition" ||
                    error.code === "unavailable")
                ) {
                    setAdBlockerDetected(true);
                    setShowAdBlockBanner(true);
                    
                    // Auto-hide the banner after 10 seconds
                    setTimeout(() => {
                        setShowAdBlockBanner(false);
                    }, 10000);
                } else {
                    setMatchError("Error listening to match updates. Redirecting to home page...");
                    setTimeout(() => navigate('/'), 3000);
                }
            });
            
            return () => {
                unsubscribe();
            };
        });
    }, [matchId, user, navigate, retryCount, testFirestoreConnectivity]);
    
    // Update connection status based on WebRTC state
    useEffect(() => {
        if (!matchData) {
            setConnectionStatus('Waiting for match data...');
            return;
        }
        
        if (isConnected) {
            setConnectionStatus('Connected');
        } else if (isConnecting) {
            setConnectionStatus('Connecting...');
        } else {
            setConnectionStatus('Disconnected');
        }
        
        const remoteTracks = remoteStream ? [...remoteStream.getTracks()] : [];
        
        // Update debug info
        setDebugInfo({
            matchId,
            isInitiator,
            hasOffer: !!matchData.offer,
            hasAnswer: !!matchData.answer,
            peerState: peerConnectionRef.current?.connectionState || 'not created',
            iceState: peerConnectionRef.current?.iceConnectionState || 'not created',
            remoteTracks: remoteTracks.length > 0 ? 
                remoteTracks.map(track => track.kind).join(', ') : 
                'No tracks',
            localTracks: localStreamRef.current ? 
                [...localStreamRef.current.getTracks()].map(track => track.kind).join(', ') : 
                'No tracks'
        });
        
    }, [matchData, isConnected, isConnecting, matchId, isInitiator, remoteStream]);
    
    // Auto-start debate when connected
    useEffect(() => {
        // Start the debate automatically when both users are connected
        if (isConnected && !debateStarted && startDebateRef.current) {
            console.log("Both users connected - automatically starting debate");
            startDebateRef.current();
        }
    }, [isConnected, debateStarted]);
    
    // Update useEffect to start debate as soon as the match exists, not just when connected
    useEffect(() => {
        // Start debate if match exists but hasn't started yet
        if (matchData && !debateStarted && startDebateRef.current) {
            console.log("Auto-starting debate on match creation");
            startDebateRef.current();
        }
    }, [matchData, debateStarted]);
    
    // Keep existing useEffect for connection status
    useEffect(() => {
        if (isConnected && !debateStarted && startDebateRef.current) {
            console.log("Auto-starting debate when both users are connected");
            startDebateRef.current();
        }
    }, [isConnected, debateStarted]);
    
    // Format debug info for display
    const formatDebugInfo = (info) => {
        return Object.entries(info).map(([key, value]) => {
            return `${key}: ${value}`;
        }).join('\n');
    };
    
    // Enhance the updatePeerConnectionState function to handle disconnections
    const updatePeerConnectionState = (peerConnection) => {
        peerConnection.oniceconnectionstatechange = async () => {
            const state = peerConnection.iceConnectionState;
            console.log("ICE connection state:", state);
            
            // Update UI based on connection state
            if (state === 'connected' || state === 'completed') {
                setIsConnected(true);
                setIsConnecting(false);
                setConnectionStatus('Connected');
                
                // Clear any disconnect timer if connection is restored
                if (disconnectionTimer) {
                    console.log("Connection restored, clearing disconnect timer");
                    clearTimeout(disconnectionTimer);
                    setDisconnectionTimer(null);
                }
            } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                setIsConnected(false);
                setIsConnecting(false);
                
                // If debate hasn't ended and this is a disconnection
                if (!showJudge && matchData && user) {
                    try {
                        // Start a timer to detect prolonged disconnection
                        const timer = setTimeout(async () => {
                            console.log(`Disconnection lasted more than ${DISCONNECT_TIMEOUT/1000} seconds, handling as forfeit`);
                            
                            // Check if match is still active
                            const matchRef = doc(db, 'matches', matchId);
                            const matchSnap = await getDoc(matchRef);
                            
                            if (matchSnap.exists() && matchSnap.data().active) {
                                console.log("Match is still active, handling disconnection");
                                
                                // Update match status
                                await updateDoc(matchRef, {
                                    active: false,
                                    endedAt: serverTimestamp(),
                                    disconnectedUser: user.uid,
                                    disconnectionReason: "forfeit",
                                    disconnectionTime: DISCONNECT_TIMEOUT/1000 // in seconds
                                });
                                
                                // Update stats
                                await updateUserStats(user.uid, false); // Loss for disconnecting player
                                
                                // Give win to other player
                                const otherUserId = isInitiator ? matchData.receiver : matchData.initiator;
                                await updateUserStats(otherUserId, true); // Win for other player
                                
                                setConnectionStatus('Disconnected. This counts as a loss.');
                                
                                // Navigate home after a short delay
                                setTimeout(() => navigate('/'), 3000);
                            }
                            
                            setDisconnectionTimer(null);
                        }, DISCONNECT_TIMEOUT);
                        
                        setDisconnectionTimer(timer);
                        console.log(`Started disconnection timer: ${DISCONNECT_TIMEOUT/1000} seconds`);
                        
                    } catch (error) {
                        console.error("Error handling disconnection:", error);
                    }
                } else {
                    setConnectionStatus(state === 'failed' ? 'Connection failed' : 'Disconnected from peer');
                }
            } else {
                setIsConnecting(true);
                setConnectionStatus(`Connecting... (${state})`);
            }
            
            // Update debug info
            setDebugInfo(prev => ({
                ...prev,
                peerState: peerConnection.connectionState || 'unknown',
                iceState: state || 'unknown'
            }));
        };
        
        // Also listen for connectionstatechange
        peerConnection.onconnectionstatechange = () => {
            console.log("Connection state:", peerConnection.connectionState);
            
            // Update debug info
            setDebugInfo(prev => ({
                ...prev,
                peerState: peerConnection.connectionState || 'unknown'
            }));
        };
    };
    
    // Enhance the endCall function to properly mark disconnection
    const endCall = async () => {
        try {
            // Clear any disconnect timer
            if (disconnectionTimer) {
                clearTimeout(disconnectionTimer);
                setDisconnectionTimer(null);
            }
            
            // Update match document to inactive and mark who disconnected
            await updateDoc(doc(db, 'matches', matchId), {
                active: false,
                endedAt: serverTimestamp(),
                disconnectedUser: user.uid,
                disconnectionReason: "voluntary_disconnect"
            });
            
            // If debate hasn't ended yet, this is a disconnection - count as loss for disconnecting player
            if (!showJudge) {
                // Update stats - loss for disconnecting player, win for other player
                await updateUserStats(user.uid, false); // Loss for disconnecting player
                
                // Determine other player's ID and give them the win
                const otherUserId = isInitiator ? matchData.receiver : matchData.initiator;
                await updateUserStats(otherUserId, true); // Win for other player
            }
            
            cleanupResources();
            navigate('/');
        } catch (error) {
            console.error("Error ending call:", error);
        }
    };
    
    // Add a function to restart the connection
    const restartConnection = async () => {
        console.log("Attempting to restart connection...");
        
        // Clear the connection setup flag
        connectionSetupDoneRef.current = false;
        
        // Clean up existing connection
        cleanupResources();
        
        // Recreate streams
        setIsConnecting(true);
        
        // If we have match data, restart the setup
        if (matchData) {
            const userIsInitiator = user.uid === matchData.initiator;
            console.log("Restarting as:", userIsInitiator ? "INITIATOR" : "RECEIVER");
            setupCallConnection(matchData, userIsInitiator);
        } else {
            console.log("No match data available, cannot restart");
            setMatchError("Cannot restart connection - no match data");
        }
    };
    
    // Add a function to retry adding ICE candidates if needed
    const retryIceCandidates = async () => {
        if (!peerConnectionRef.current || !matchId) return;
        
        try {
            console.log("Retrying ICE candidate collection");
            
            // Get all candidates for this match
            const isUserInitiator = user.uid === matchData.initiator;
            
            const candidatesCollection = isUserInitiator ? 'answerCandidates' : 'offerCandidates';
            const candidatesQuery = query(
                collection(db, candidatesCollection),
                where('matchId', '==', matchId)
            );
            
            const candidatesSnapshot = await getDocs(candidatesQuery);
            
            // Add all candidates again
            let count = 0;
            for (const doc of candidatesSnapshot.docs) {
                const data = doc.data();
                try {
                    await peerConnectionRef.current.addIceCandidate(
                        new RTCIceCandidate(data.candidate)
                    );
                    count++;
                } catch (err) {
                    console.error("Error re-adding ICE candidate:", err);
                }
            }
            
            console.log(`Retried adding ${count} ICE candidates`);
            setDebugInfo(prev => ({
                ...prev,
                retriedIceCandidates: count
            }));
            
        } catch (error) {
            console.error("Error retrying ICE candidates:", error);
        }
    };
    
    // Main WebRTC setup function - creates a connection
    const setupCallConnection = async (matchDataParam, isUserInitiator) => {
        if (connectionSetupDoneRef.current) {
            console.log("Connection setup already done, skipping");
            return;
        }
        
        // Use the passed matchData parameter instead of the state
        if (!matchDataParam) {
            console.log("No match data provided, cannot setup connection");
            return;
        }
        
        connectionSetupDoneRef.current = true;
        console.log("Setting up WebRTC connection");
        console.log("Setting up as:", isUserInitiator ? "INITIATOR" : "RECEIVER");
        console.log("Using match data:", matchDataParam);
        
        try {
            // Get local stream
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            
            setLocalStream(stream);
            localStreamRef.current = stream;
            
            // Create peer connection
            const peerConnection = new RTCPeerConnection(servers);
            peerConnectionRef.current = peerConnection;
            
            // Register connection state handlers
            updatePeerConnectionState(peerConnection);
            
            // Add local tracks to peer connection
            stream.getTracks().forEach(track => {
                peerConnection.addTrack(track, stream);
            });
            
            // Handle incoming tracks
            peerConnection.ontrack = (event) => {
                console.log("Received remote track:", event.track.kind);
                event.streams[0].getTracks().forEach(track => {
                    console.log("Adding track to remote stream:", track.kind);
                    remoteStream.addTrack(track);
                });
                logRemoteTracks();
                setIsConnected(true);
                setIsConnecting(false);
            };
            
            // ICE candidates handling
            peerConnection.onicecandidate = (event) => {
                if (!event.candidate) return;
                
                console.log("Adding " + (isUserInitiator ? "offer" : "answer") + " ICE candidate");
                
                // Add candidate to the appropriate collection
                addDoc(collection(db, isUserInitiator ? 'offerCandidates' : 'answerCandidates'), {
                    matchId: matchId,
                    candidate: event.candidate.toJSON(),
                    timestamp: serverTimestamp()
                });
            };
            
            // Setup chat data channel
            if (isUserInitiator) {
                console.log("Creating chat data channel");
                const chatChannel = peerConnection.createDataChannel("chat");
                setupChatChannel(chatChannel);
            } else {
                peerConnection.ondatachannel = (event) => {
                    console.log("Received chat data channel");
                    setupChatChannel(event.channel);
                };
            }
            
            // Initiator creates and sends offer
            if (isUserInitiator) {
                // Create offer
                const offerDescription = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offerDescription);
                
                console.log("Created offer and set local description");
                
                // Save offer to Firestore
                await updateDoc(doc(db, 'matches', matchId), {
                    offer: {
                        type: offerDescription.type,
                        sdp: offerDescription.sdp
                    },
                    offerTimestamp: serverTimestamp()
                });
                
                console.log("Saved offer to Firestore");
                
                // Listen for answer
                onSnapshot(doc(db, 'matches', matchId), async (docSnapshot) => {
                    const data = docSnapshot.data();
                    if (!peerConnection.currentRemoteDescription && data?.answer) {
                        console.log("Received answer from remote peer");
                        const answerDescription = new RTCSessionDescription(data.answer);
                        await peerConnection.setRemoteDescription(answerDescription);
                    }
                });
                
                // Listen for answer ICE candidates
                const answerCandidatesQuery = query(
                    collection(db, 'answerCandidates'),
                    where('matchId', '==', matchId)
                );
                
                onSnapshot(answerCandidatesQuery, (snapshot) => {
                    snapshot.docChanges().forEach(async (change) => {
                        if (change.type === 'added') {
                            const data = change.doc.data();
                            console.log("Adding answer ICE candidate");
                            try {
                                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                            } catch (err) {
                                console.error("Error adding ICE candidate:", err);
                            }
                        }
                    });
                });
            } 
            // Receiver handles offer and creates answer
            else {
                console.log("Receiver found offer?", matchDataParam?.offer ? "YES" : "NO");
                if (matchDataParam?.offer) {
                    console.log("Offer details:", matchDataParam.offer);
                    
                    try {
                        // Set remote description (the offer)
                        const offerDescription = new RTCSessionDescription(matchDataParam.offer);
                        await peerConnection.setRemoteDescription(offerDescription);
                        
                        // Create answer
                        const answerDescription = await peerConnection.createAnswer();
                        await peerConnection.setLocalDescription(answerDescription);
                        
                        console.log("Created answer and set local description");
                        
                        // Save answer to Firestore
                        await updateDoc(doc(db, 'matches', matchId), {
                            answer: {
                                type: answerDescription.type,
                                sdp: answerDescription.sdp
                            },
                            answerTimestamp: serverTimestamp()
                        });
                        
                        console.log("Saved answer to Firestore");
                    } catch (error) {
                        console.error("Error setting up receiver connection:", error);
                    }
                } else {
                    console.log("No offer found yet, waiting for offer");
                    
                    // Listen for offer updates
                    onSnapshot(doc(db, 'matches', matchId), async (docSnapshot) => {
                        try {
                            const data = docSnapshot.data();
                            
                            if (!peerConnection.currentRemoteDescription && data?.offer) {
                                console.log("Received offer from remote peer");
                                const offerDescription = new RTCSessionDescription(data.offer);
                                await peerConnection.setRemoteDescription(offerDescription);
                                
                                // Create answer if we haven't already
                                if (!peerConnection.currentLocalDescription) {
                                    const answerDescription = await peerConnection.createAnswer();
                                    await peerConnection.setLocalDescription(answerDescription);
                                    
                                    console.log("Created answer and set local description after receiving offer");
                                    
                                    await updateDoc(doc(db, 'matches', matchId), {
                                        answer: {
                                            type: answerDescription.type,
                                            sdp: answerDescription.sdp
                                        },
                                        answerTimestamp: serverTimestamp()
                                    });
                                    
                                    console.log("Saved answer to Firestore after receiving offer");
                                }
                            }
                        } catch (error) {
                            console.error("Error in offer listener:", error);
                        }
                    });
                }
                
                // Listen for offer ICE candidates
                const offerCandidatesQuery = query(
                    collection(db, 'offerCandidates'),
                    where('matchId', '==', matchId)
                );
                
                onSnapshot(offerCandidatesQuery, (snapshot) => {
                    snapshot.docChanges().forEach(async (change) => {
                        if (change.type === 'added') {
                            const data = change.doc.data();
                            console.log("Adding offer ICE candidate");
                            try {
                                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                            } catch (err) {
                                console.error("Error adding ICE candidate:", err);
                            }
                        }
                    });
                });
            }
        } catch (error) {
            console.error("Error setting up call connection:", error);
            setIsConnecting(false);
            alert(`Failed to setup call: ${error.message}`);
        }
    };
    
    // Add toggle function for chat visibility
    const toggleChat = () => {
        setIsChatVisible(!isChatVisible);
    };
    
    // Determine current speaker's name for the chat based on debate stage
    const getCurrentSpeakerName = () => {
        if (!debateStarted || currentStageIndex >= DEBATE_STAGES.length) {
            return 'No one';
        }
        
        const stage = DEBATE_STAGES[currentStageIndex];
        
        if (stage.whoSpeaks === 'initiator') {
            return isInitiator ? 'Your' : 'First Speaker\'s';
        } else if (stage.whoSpeaks === 'receiver') {
            return isInitiator ? 'Second Speaker\'s' : 'Your';
        } else if (stage.whoSpeaks === 'both') {
            return 'Both Speakers\'';
        } else {
            return 'No one\'s';
        }
    };
    
    // Add this function to toggle camera on/off
    const toggleCamera = () => {
        if (localStream) {
            const videoTracks = localStream.getVideoTracks();
            videoTracks.forEach(track => {
                track.enabled = !track.enabled;
            });
            setIsCameraEnabled(!isCameraEnabled);
        }
    };
    
    // Add this new function for setting up the chat channel
    const setupChatChannel = (channel) => {
        chatChannelRef.current = channel;
        
        channel.onopen = () => {
            console.log("Chat channel opened");
        };
        
        channel.onclose = () => {
            console.log("Chat channel closed");
        };
        
        channel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                // Handle incoming chat message
                // This will be used by the ChatBox component
                console.log("Received chat message:", message);
                
                // Store message in local state or pass to ChatBox
                if (onChatMessage) {
                    onChatMessage(message);
                }
            } catch (error) {
                console.error("Error handling chat message:", error);
            }
        };
    };
    
    // Add this function to send chat messages
    const sendChatMessage = (message) => {
        if (chatChannelRef.current?.readyState === 'open') {
            try {
                const messageData = JSON.stringify({
                    text: message,
                    timestamp: new Date().toISOString(),
                    isInitiator,
                    debateStage: getCurrentStage().name
                });
                chatChannelRef.current.send(messageData);
            } catch (error) {
                console.error("Error sending chat message:", error);
            }
        } else {
            console.error("Chat channel not ready");
        }
    };
    
    // Function to detect voice activity
    const detectVoiceActivity = useCallback((audioLevel, isLocal) => {
        // Only track during open discussion stage
        if (debateStarted && currentStageIndex === 2) { // Open Discussion index
            const now = Date.now();
            const userType = isLocal ? (isInitiator ? "initiator" : "receiver") : (isInitiator ? "receiver" : "initiator");
            
            // Check if voice is active (audioLevel above threshold)
            if (audioLevel > 0.05) { // Threshold for voice activity
                setOpenDiscussionStats(prev => {
                    // If this is a new speaking session or speaker changed
                    if (prev.currentSpeaker !== userType && prev.lastSpeakingTimestamp !== null) {
                        // Calculate time spent by previous speaker
                        const timeDiff = now - prev.lastSpeakingTimestamp;
                        
                        // Update the speaking time for the previous speaker
                        const updatedStats = {
                            ...prev,
                            currentSpeaker: userType,
                            lastSpeakingTimestamp: now
                        };
                        
                        if (prev.currentSpeaker === "initiator") {
                            updatedStats.initiatorSpeakingTime += timeDiff;
                        } else if (prev.currentSpeaker === "receiver") {
                            updatedStats.receiverSpeakingTime += timeDiff;
                        }
                        
                        return updatedStats;
                    }
                    
                    // If this is the first time detecting voice or same speaker
                    return {
                        ...prev,
                        currentSpeaker: userType,
                        lastSpeakingTimestamp: prev.lastSpeakingTimestamp === null ? now : prev.lastSpeakingTimestamp
                    };
                });
            } else if (openDiscussionStats.currentSpeaker && openDiscussionStats.lastSpeakingTimestamp) {
                // Voice stopped, update the time for the current speaker
                setOpenDiscussionStats(prev => {
                    if (!prev.currentSpeaker) return prev;
                    
                    const timeDiff = now - prev.lastSpeakingTimestamp;
                    const updatedStats = {
                        ...prev,
                        lastSpeakingTimestamp: null,
                        currentSpeaker: null
                    };
                    
                    if (prev.currentSpeaker === "initiator") {
                        updatedStats.initiatorSpeakingTime += timeDiff;
                    } else if (prev.currentSpeaker === "receiver") {
                        updatedStats.receiverSpeakingTime += timeDiff;
                    }
                    
                    return updatedStats;
                });
            }
            
            // Check for dominance and apply penalty if needed
            checkForDominancePenalty();
        }
    }, [debateStarted, currentStageIndex, isInitiator, openDiscussionStats]);
    
    // Function to check if a user is dominating the conversation
    const checkForDominancePenalty = useCallback(() => {
        if (openDiscussionStats.dominancePenaltyApplied) return;
        
        const totalSpeakingTime = openDiscussionStats.initiatorSpeakingTime + openDiscussionStats.receiverSpeakingTime;
        
        // Only check if there's a reasonable amount of speaking time logged
        if (totalSpeakingTime > 10000) { // More than 10 seconds
            const initiatorPercentage = openDiscussionStats.initiatorSpeakingTime / totalSpeakingTime;
            const receiverPercentage = openDiscussionStats.receiverSpeakingTime / totalSpeakingTime;
            
            // Check if either user exceeds the warning threshold
            const isInitiatorDominating = initiatorPercentage > DOMINANCE_WARNING_THRESHOLD;
            const isReceiverDominating = receiverPercentage > DOMINANCE_WARNING_THRESHOLD;
            
            // Show warning for the user who's currently speaking too much
            if ((isInitiatorDominating && isInitiator) || (isReceiverDominating && !isInitiator)) {
                setShowDominanceWarning(true);
            } else {
                setShowDominanceWarning(false);
            }
            
            // Check if either user exceeds the maximum allowed percentage
            if (initiatorPercentage > MAX_OPEN_DISCUSSION_DOMINANCE) {
                // Initiator dominated, add penalty info to match data
                applyDominancePenalty("initiator", initiatorPercentage);
            } else if (receiverPercentage > MAX_OPEN_DISCUSSION_DOMINANCE) {
                // Receiver dominated, add penalty info to match data
                applyDominancePenalty("receiver", receiverPercentage);
            }
        }
    }, [openDiscussionStats, isInitiator]);
    
    // Function to apply the dominance penalty
    const applyDominancePenalty = async (dominantRole, percentage) => {
        try {
            if (!matchId || openDiscussionStats.dominancePenaltyApplied) return;
            
            console.log(`Applying dominance penalty to ${dominantRole} for controlling ${Math.round(percentage * 100)}% of the conversation`);
            
            // Mark as applied to prevent multiple penalties
            setOpenDiscussionStats(prev => ({
                ...prev,
                dominancePenaltyApplied: true
            }));
            
            // Update the match document with the penalty information
            const matchRef = doc(db, 'matches', matchId);
            await updateDoc(matchRef, {
                dominancePenalty: {
                    appliedTo: dominantRole,
                    percentage: percentage,
                    initiatorSpeakingTime: openDiscussionStats.initiatorSpeakingTime,
                    receiverSpeakingTime: openDiscussionStats.receiverSpeakingTime,
                    timestamp: serverTimestamp()
                }
            });
            
            // If the current user is the one who dominated, notify them
            if ((dominantRole === "initiator" && isInitiator) || 
                (dominantRole === "receiver" && !isInitiator)) {
                alert("You have been penalized for dominating the conversation. This will affect the final debate outcome.");
            }
        } catch (error) {
            console.error("Error applying dominance penalty:", error);
        }
    };
    
    // Set up audio level monitoring
    useEffect(() => {
        if (!localStream || !debateStarted) return;
        
        // Create audio analyzer to monitor speaking volume
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const analyzer = audioContext.createAnalyser();
            const microphone = audioContext.createMediaStreamSource(localStream);
            microphone.connect(analyzer);
            
            analyzer.fftSize = 256;
            const bufferLength = analyzer.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            // Function to check audio levels periodically
            const checkAudioLevel = () => {
                analyzer.getByteFrequencyData(dataArray);
                
                // Calculate average audio level
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) {
                    sum += dataArray[i];
                }
                const averageLevel = sum / bufferLength / 255; // Normalize to 0-1
                
                // Call the voice activity detector
                detectVoiceActivity(averageLevel, true);
            };
            
            // Check audio level every 500ms
            const intervalId = setInterval(checkAudioLevel, 500);
            
            return () => {
                clearInterval(intervalId);
                if (audioContext.state !== 'closed') {
                    audioContext.close();
                }
            };
        } catch (error) {
            console.error("Error setting up audio monitoring:", error);
        }
    }, [localStream, debateStarted, detectVoiceActivity]);
    
    // Update speaking stats at the end of open discussion
    useEffect(() => {
        if (debateStarted && currentStageIndex === 3 && DEBATE_STAGES[currentStageIndex - 1].name === "Open Discussion") {
            // Open discussion just ended, finalize speaking stats
            if (openDiscussionStats.currentSpeaker && openDiscussionStats.lastSpeakingTimestamp) {
                const now = Date.now();
                const timeDiff = now - openDiscussionStats.lastSpeakingTimestamp;
                
                setOpenDiscussionStats(prev => {
                    const updatedStats = {
                        ...prev,
                        lastSpeakingTimestamp: null,
                        currentSpeaker: null
                    };
                    
                    if (prev.currentSpeaker === "initiator") {
                        updatedStats.initiatorSpeakingTime += timeDiff;
                    } else if (prev.currentSpeaker === "receiver") {
                        updatedStats.receiverSpeakingTime += timeDiff;
                    }
                    
                    return updatedStats;
                });
            }
            
            // Final check for dominance
            checkForDominancePenalty();
            
            // Save the final speaking stats to the match document
            const updateMatchWithSpeakingStats = async () => {
                try {
                    const matchRef = doc(db, 'matches', matchId);
                    await updateDoc(matchRef, {
                        openDiscussionStats: {
                            initiatorSpeakingTime: openDiscussionStats.initiatorSpeakingTime,
                            receiverSpeakingTime: openDiscussionStats.receiverSpeakingTime,
                            endedAt: serverTimestamp()
                        }
                    });
                } catch (error) {
                    console.error("Error saving speaking stats:", error);
                }
            };
            
            updateMatchWithSpeakingStats();
        }
    }, [currentStageIndex, debateStarted, matchId, openDiscussionStats, checkForDominancePenalty]);
    
    // Add a new useEffect to handle disconnection detection and cleanup
    useEffect(() => {
        return () => {
            // Clear any active disconnection timer when component unmounts
            if (disconnectionTimer) {
                clearTimeout(disconnectionTimer);
            }
        };
    }, [disconnectionTimer]);
    
    return (
        <div className="call-container">
            <h2>Video Call</h2>
            
            {/* Ad blocker alert banner */}
            <div className={`adblock-alert-banner ${showAdBlockBanner ? 'visible' : ''}`}>
                <button className="close-button" onClick={() => setShowAdBlockBanner(false)}>×</button>
                <p>Ad Blocker Detected</p>
                <div className="message">
                    Some features may not work properly. For the best experience, please disable your ad blocker.
                </div>
            </div>
            
            {matchError ? (
                <div className="error-message">
                    {matchError}
                </div>
            ) : (
                <>
                    <div className="video-grid">
                        <div className="video-container local">
                            <video 
                                ref={localVideoRef} 
                                autoPlay 
                                playsInline 
                                muted
                            />
                            <p>You ({isInitiator ? 'First Speaker' : 'Second Speaker'})
                               {!isLocalAudioEnabled && <span className="muted-indicator"> 🔇</span>}
                               {!isCameraEnabled && <span className="camera-off-indicator"> 📵</span>}
                            </p>
                            <div className="video-controls">
                                <button 
                                    className={`video-control-button ${!isCameraEnabled ? 'disabled' : ''}`}
                                    onClick={toggleCamera}
                                    title={isCameraEnabled ? 'Turn Camera Off' : 'Turn Camera On'}
                                >
                                    {isCameraEnabled ? '🎥' : '⛔'}
                                </button>
                            </div>
                        </div>
                        
                        <div className="video-container remote">
                            <video 
                                ref={remoteVideoRef} 
                                autoPlay 
                                playsInline
                            />
                            <p>
                                {connectionStatus}
                            </p>
                        </div>
                        
                        {showJudge && (
                            <div className="judge-container">
                                <DebateJudge 
                                    isVisible={showJudge}
                                    localCharacter={isInitiator ? 
                                        (matchData?.initiatorCharacter || "First Speaker") : 
                                        (matchData?.receiverCharacter || "Second Speaker")}
                                    remoteCharacter={isInitiator ? 
                                        (matchData?.receiverCharacter || "Second Speaker") : 
                                        (matchData?.initiatorCharacter || "First Speaker")}
                                    localTranscript={isInitiator ? localTranscriptHistory : remoteTranscriptHistory}
                                    remoteTranscript={isInitiator ? remoteTranscriptHistory : localTranscriptHistory}
                                    evaluationCriteria={judgeEvaluationCriteria}
                                    matchData={matchData}
                                />
                            </div>
                        )}
                    </div>
                    
                    <div className="debate-controls">
                        {debateStarted && (
                            <div className={`debate-status ${getCurrentStage().whoSpeaks === "initiator" 
                              ? "first-speaker" 
                              : getCurrentStage().whoSpeaks === "receiver" 
                              ? "second-speaker" 
                              : getCurrentStage().whoSpeaks === "both" 
                              ? "open-discussion"
                              : "ended"}`}>
                                <div className="stage-info">
                                    <h3>{getCurrentStage().name}</h3>
                                    <div className="timer">{formatTime(timeRemaining)}</div>
                                </div>
                                <div className="speaking-info">
                                    {getCurrentStage().whoSpeaks === "both" ? (
                                        <p>Both participants can speak</p>
                                    ) : getCurrentStage().whoSpeaks === "initiator" ? (
                                        <p>First speaker's turn {isInitiator ? "(You)" : ""}</p>
                                    ) : getCurrentStage().whoSpeaks === "receiver" ? (
                                        <p>Second speaker's turn {!isInitiator ? "(You)" : ""}</p>
                                    ) : (
                                        <p>Debate has ended</p>
                                    )}
                                </div>
                                {getCurrentStage().whoSpeaks === "both" && showDominanceWarning && (
                                    <div className="dominance-warning">
                                        <span>⚠️ Warning: You're speaking too much. Let the other person talk more to avoid a penalty.</span>
                                    </div>
                                )}
                                <div className="speaker-status">
                                    {isLocalAudioEnabled ? (
                                        <span className="can-speak">You can speak now</span>
                                    ) : (
                                        <span className="cannot-speak">You are muted until your turn</span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    
                    <div className="transcription-container">
                        <div className="transcription-controls">
                            <button 
                                className={`transcription-toggle ${transcriptionEnabled ? 'enabled' : 'disabled'}`}
                                onClick={toggleTranscription}
                            >
                                {transcriptionEnabled ? 'Disable Transcription' : 'Enable Transcription'}
                            </button>
                        </div>
                        
                        {transcriptionEnabled && (
                            <div className="transcriptions">
                                <div className="transcription local-transcription">
                                    <h4>You:</h4>
                                    <p>{localTranscription || "Waiting for speech..."}</p>
                                </div>
                                <div className="transcription remote-transcription">
                                    <h4>Other Speaker:</h4>
                                    <p>{remoteTranscription || "Waiting for speech..."}</p>
                                </div>
                            </div>
                        )}
                    </div>
                    
                    <div className="call-controls">
                        <button onClick={toggleCamera} className={`camera-toggle-button ${!isCameraEnabled ? 'disabled' : ''}`}>
                            {isCameraEnabled ? 'Turn Camera Off' : 'Turn Camera On'}
                        </button>
                        <button onClick={endCall} className="end-call-button">
                            End Call
                        </button>
                        <button onClick={restartConnection} className="restart-call-button">
                            Restart Connection
                        </button>
                        <button onClick={retryIceCandidates} className="retry-button">
                            Retry ICE
                        </button>
                    </div>
                    
                    <div className="connection-status">
                        {!isConnected && isConnecting && (
                            <div className="connecting-message">
                                <p>Connecting to your partner...</p>
                                <p className="connection-tips">
                                    If it's taking too long, try:
                                    <br />1. Check that you allowed camera/microphone access
                                    <br />2. Click "Restart Connection"
                                    <br />3. Try using a different browser
                                </p>
                            </div>
                        )}
                    </div>
                    
                    <div className="debug-info">
                        {formatDebugInfo(debugInfo)}
                    </div>
                    
                    <div className="chat-controls">
                        <button 
                            className={`chat-toggle-button ${isChatVisible ? 'active' : ''}`}
                            onClick={toggleChat}
                        >
                            {isChatVisible ? 'Hide Chat' : 'Show Chat'}
                        </button>
                    </div>
                    
                    {isChatVisible && matchData && (
                        <ChatBox
                            matchId={matchId}
                            userId={user?.uid}
                            isInitiator={isInitiator}
                            currentSpeaker={getCurrentSpeakerName()}
                            debateStage={currentStageIndex < DEBATE_STAGES.length ? DEBATE_STAGES[currentStageIndex] : null}
                            onSendMessage={sendChatMessage}
                            useWebRTC={true}
                        />
                    )}
                </>
            )}
        </div>
    );
}

export default Call;