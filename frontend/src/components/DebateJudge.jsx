import React, { useState, useEffect, useCallback } from 'react';
import { createDeepseekService } from '../services/deepseekService';
import { updateUserStats } from '../services/statsService';
import { auth, db } from '../services/firebase.jsx';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import './DebateJudge.css';

const DebateJudge = ({ 
    isVisible, 
    localCharacter, 
    remoteCharacter, 
    localTranscript, 
    remoteTranscript,
    evaluationCriteria,
    matchData
}) => {
    const [evaluation, setEvaluation] = useState('');
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [error, setError] = useState(null);
    const [winnerDetermined, setWinnerDetermined] = useState(false);
    const [dominancePenalty, setDominancePenalty] = useState(null);
    
    const deepseekService = createDeepseekService();
    
    // Check for dominance penalty in match data
    useEffect(() => {
        if (matchData && matchData.dominancePenalty) {
            setDominancePenalty(matchData.dominancePenalty);
            console.log("Found dominance penalty:", matchData.dominancePenalty);
        }
    }, [matchData]);
    
    // Determine if the current user won based on the evaluation text
    const determineWinner = useCallback((evaluationText) => {
        if (!evaluationText || !auth.currentUser || !matchData) return;
        
        const userId = auth.currentUser.uid;
        const isInitiator = matchData.initiator === userId;
        
        // Check if there's a dominance penalty that should override the AI's decision
        if (dominancePenalty) {
            const penalizedRole = dominancePenalty.appliedTo;
            console.log(`Dominance penalty found for ${penalizedRole} user.`);
            
            // The penalized user loses automatically
            if (penalizedRole === "initiator") {
                // Initiator loses, receiver wins
                updateUserStats(userId, isInitiator ? false : true);
                setWinnerDetermined(true);
                
                // Add explanation about the penalty to the evaluation
                const penaltyExplanation = `\n\n**DEBATE PENALTY APPLIED**\n
The first speaker dominated the open discussion by controlling ${Math.round(dominancePenalty.percentage * 100)}% of the speaking time.
According to debate rules, excessively dominating the conversation results in an automatic loss.
Therefore, the second speaker wins this debate, regardless of content quality.`;
                
                setEvaluation(evaluationText + penaltyExplanation);
                return;
            } else if (penalizedRole === "receiver") {
                // Receiver loses, initiator wins
                updateUserStats(userId, isInitiator ? true : false);
                setWinnerDetermined(true);
                
                // Add explanation about the penalty to the evaluation
                const penaltyExplanation = `\n\n**DEBATE PENALTY APPLIED**\n
The second speaker dominated the open discussion by controlling ${Math.round(dominancePenalty.percentage * 100)}% of the speaking time.
According to debate rules, excessively dominating the conversation results in an automatic loss.
Therefore, the first speaker wins this debate, regardless of content quality.`;
                
                setEvaluation(evaluationText + penaltyExplanation);
                return;
            }
        }
        
        // If no penalty or if penalty check doesn't result in a decision, proceed with normal evaluation
        
        // Look for winner declaration in the text
        const lowerCaseEval = evaluationText.toLowerCase();
        
        // Check for explicit mentions of character names in context of winning
        const localWinRegex = new RegExp(`(${localCharacter.toLowerCase()}|first speaker|initiator)\\s+wins`, 'i');
        const remoteWinRegex = new RegExp(`(${remoteCharacter.toLowerCase()}|second speaker|receiver)\\s+wins`, 'i');
        
        const localWins = localWinRegex.test(lowerCaseEval);
        const remoteWins = remoteWinRegex.test(lowerCaseEval);
        
        // If both or neither are found, look for final decision
        if ((localWins && remoteWins) || (!localWins && !remoteWins)) {
            const finalDecisionSection = lowerCaseEval.split('final decision').pop() || '';
            
            // Check final decision section
            const localWinsInFinal = localWinRegex.test(finalDecisionSection);
            const remoteWinsInFinal = remoteWinRegex.test(finalDecisionSection);
            
            if (localWinsInFinal && !remoteWinsInFinal) {
                updateUserStats(userId, isInitiator);
                setWinnerDetermined(true);
                return;
            } else if (remoteWinsInFinal && !localWinsInFinal) {
                updateUserStats(userId, !isInitiator);
                setWinnerDetermined(true);
                return;
            }
        } else if (localWins && !remoteWins) {
            // Local character won
            updateUserStats(userId, isInitiator);
            setWinnerDetermined(true);
            return;
        } else if (remoteWins && !localWins) {
            // Remote character won
            updateUserStats(userId, !isInitiator);
            setWinnerDetermined(true);
            return;
        }
        
        // If still not determined, check for winner/loser statements
        if (lowerCaseEval.includes('winner is') || lowerCaseEval.includes('winner:')) {
            const winnerSection = lowerCaseEval.split(/winner is|winner:/i).pop() || '';
            
            if (winnerSection.includes(localCharacter.toLowerCase())) {
                updateUserStats(userId, isInitiator);
                setWinnerDetermined(true);
            } else if (winnerSection.includes(remoteCharacter.toLowerCase())) {
                updateUserStats(userId, !isInitiator);
                setWinnerDetermined(true);
            }
        }
    }, [localCharacter, remoteCharacter, matchData, dominancePenalty]);
    
    // Check for existing evaluation in Firestore
    const checkExistingEvaluation = async () => {
        if (!matchData || !matchData.id) return null;
        
        try {
            const matchRef = doc(db, 'matches', matchData.id);
            const matchDoc = await getDoc(matchRef);
            
            if (matchDoc.exists() && matchDoc.data().evaluation) {
                console.log("Found existing evaluation in Firestore");
                return matchDoc.data().evaluation;
            }
            
            return null;
        } catch (error) {
            console.error("Error checking for existing evaluation:", error);
            return null;
        }
    };
    
    // Request debate evaluation when the component becomes visible
    useEffect(() => {
        if (isVisible && !evaluation && !isEvaluating) {
            evaluateDebate();
        }
    }, [isVisible]);
    
    // Determine winner when evaluation is set
    useEffect(() => {
        if (evaluation && !winnerDetermined) {
            determineWinner(evaluation);
        }
    }, [evaluation, winnerDetermined, determineWinner]);
    
    const evaluateDebate = async () => {
        setIsEvaluating(true);
        setError(null);
        
        try {
            // First check if an evaluation already exists in Firestore
            const existingEvaluation = await checkExistingEvaluation();
            
            if (existingEvaluation) {
                console.log("Using existing evaluation from Firestore");
                setEvaluation(existingEvaluation);
                setIsEvaluating(false);
                return;
            }
            
            // Check if dominance penalty should be applied immediately
            if (dominancePenalty) {
                console.log("Dominance penalty will be applied to debate evaluation");
                // We'll still get the AI evaluation but will override the winner decision
            }
            
            // No existing evaluation, generate a new one
            console.log("No existing evaluation found, generating new one");
            
            // Use transcripts directly without fetching chat messages
            const combinedLocalTranscript = localTranscript;
            const combinedRemoteTranscript = remoteTranscript;
            
            console.log("Using transcripts for evaluation:", {
                localLength: combinedLocalTranscript.length,
                remoteLength: combinedRemoteTranscript.length
            });
            
            // Add dominance instruction to evaluation criteria if penalty exists
            let enhancedCriteria = evaluationCriteria;
            if (dominancePenalty) {
                const penalizedRole = dominancePenalty.appliedTo;
                const penalizedSpeaker = penalizedRole === "initiator" ? "first speaker" : "second speaker";
                enhancedCriteria += `\n\nIMPORTANT: The ${penalizedSpeaker} dominated the open discussion period by taking ${Math.round(dominancePenalty.percentage * 100)}% of the speaking time, which violates debate fairness rules. According to the rules, this results in an automatic loss for the ${penalizedSpeaker}, regardless of argument quality.`;
            }
            
            const result = await deepseekService.evaluateDebate({
                localTranscript: combinedLocalTranscript,
                remoteTranscript: combinedRemoteTranscript,
                localCharacter,
                remoteCharacter,
                evaluationCriteria: enhancedCriteria
            });
            
            if (result.success) {
                let finalEvaluation = result.evaluation;
                
                // If dominance penalty exists, make sure it's clearly mentioned
                if (dominancePenalty && !finalEvaluation.toLowerCase().includes("dominat")) {
                    const penalizedRole = dominancePenalty.appliedTo;
                    const penalizedSpeaker = penalizedRole === "initiator" ? "first speaker" : "second speaker";
                    const winnerSpeaker = penalizedRole === "initiator" ? "second speaker" : "first speaker";
                    
                    const penaltyExplanation = `\n\n**DEBATE PENALTY APPLIED**\n
The ${penalizedSpeaker} dominated the open discussion by controlling ${Math.round(dominancePenalty.percentage * 100)}% of the speaking time.
According to debate rules, excessively dominating the conversation results in an automatic loss.
Therefore, the ${winnerSpeaker} wins this debate, regardless of content quality.`;
                    
                    finalEvaluation += penaltyExplanation;
                }
                
                // Store the evaluation and winner in Firestore
                await updateDoc(doc(db, 'matches', matchData.id), {
                    evaluation: finalEvaluation,
                    winner: dominancePenalty ? 
                        (dominancePenalty.appliedTo === "initiator" ? "receiver" : "initiator") : 
                        result.winner,
                    evaluatedAt: serverTimestamp()
                });
                
                setEvaluation(finalEvaluation);
            } else {
                setError(result.error || 'Failed to evaluate the debate');
            }
        } catch (error) {
            console.error('Error evaluating debate:', error);
            setError('An unexpected error occurred during evaluation');
        } finally {
            setIsEvaluating(false);
        }
    };
    
    if (!isVisible) {
        return null;
    }
    
    return (
        <div className="debate-judge">
            <h2>AI Debate Judge</h2>
            
            {isEvaluating ? (
                <div className="loading-container">
                    <div className="loading-spinner"></div>
                    <p>Evaluating the debate...</p>
                </div>
            ) : error ? (
                <div className="error-message">
                    <p>{error}</p>
                    <button onClick={evaluateDebate}>Try Again</button>
                </div>
            ) : evaluation ? (
                <div className="evaluation-container">
                    {dominancePenalty && (
                        <div className="dominance-penalty-banner">
                            <h3>Conversation Dominance Penalty Applied</h3>
                            <p>One participant excessively dominated the open discussion period, resulting in an automatic loss.</p>
                        </div>
                    )}
                    <div className="evaluation-text">
                        {evaluation.split('\n').map((paragraph, i) => (
                            <p key={i}>{paragraph}</p>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="loading-container">
                    <p>Preparing evaluation...</p>
                </div>
            )}
        </div>
    );
};

export default DebateJudge; 