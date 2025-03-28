// Deepgram API key
// If you encounter authentication errors, you may need to replace this with a new API key
// from your Deepgram account at https://console.deepgram.com/
const DEEPGRAM_API_KEY = "1712f4e443f9146d74bef1a0199c2e605736ac8d";

/**
 * Creates a transcription service to handle real-time transcription of audio streams.
 * @param {Object} options - Configuration options
 * @param {Function} options.onLocalTranscription - Callback when local transcription updates
 * @param {Function} options.onRemoteTranscription - Callback when remote transcription updates
 * @returns {Object} - Transcription service methods and utilities
 */
export const createTranscriptionService = ({ onLocalTranscription, onRemoteTranscription }) => {
    // Internal state
    let localMediaRecorder = null;
    let remoteMediaRecorder = null;
    let localDeepgramSocket = null;
    let remoteDeepgramSocket = null;
    let transcriptionTimeout = null;
    let localTranscriptionText = "";
    let remoteTranscriptionText = "";
    
    // Store complete debate transcript history (not limited to 500 chars)
    let localTranscriptionHistory = "";
    let remoteTranscrptionHistory = "";
    
    /**
     * Clean up all transcription resources
     */
    const cleanup = () => {
        console.log("Cleaning up transcription resources");
        // Stop media recorders
        if (localMediaRecorder) {
            if (localMediaRecorder.state === 'recording') {
                localMediaRecorder.stop();
            }
            localMediaRecorder = null;
        }
        
        if (remoteMediaRecorder) {
            if (remoteMediaRecorder.state === 'recording') {
                remoteMediaRecorder.stop();
            }
            remoteMediaRecorder = null;
        }
        
        // Close WebSocket connections
        if (localDeepgramSocket) {
            if (localDeepgramSocket.readyState === WebSocket.OPEN) {
                localDeepgramSocket.close();
            }
            localDeepgramSocket = null;
        }
        
        if (remoteDeepgramSocket) {
            if (remoteDeepgramSocket.readyState === WebSocket.OPEN) {
                remoteDeepgramSocket.close();
            }
            remoteDeepgramSocket = null;
        }
        
        // Clear any pending timeouts
        if (transcriptionTimeout) {
            clearTimeout(transcriptionTimeout);
            transcriptionTimeout = null;
        }
        
        // We don't reset transcript history here to preserve it for the judge
        // Reset display text only
        localTranscriptionText = "";
        remoteTranscriptionText = "";
        
        console.log("Transcription resources cleaned up");
    };
    
    /**
     * Update transcription text and limit to ~500 characters
     * @param {string} text - New transcript text to add
     * @param {boolean} isLocal - Whether this is for local or remote transcription
     */
    const updateTranscription = (text, isLocal) => {
        if (!text || !text.trim()) return;
        
        // Make sure text is a string and trim whitespace
        const cleanText = String(text).trim();
        
        if (isLocal) {
            // Add the new text and limit to ~500 characters for display
            const newText = (localTranscriptionText + " " + cleanText).trim();
            localTranscriptionText = newText.length > 500 
                ? "..." + newText.substring(newText.length - 500) 
                : newText;
            
            // Also add to the complete history without limiting length
            localTranscriptionHistory = (localTranscriptionHistory + " " + cleanText).trim();
                
            // Update via callback
            if (onLocalTranscription) {
                onLocalTranscription(localTranscriptionText);
                console.log("Updated local transcription:", localTranscriptionText);
            }
        } else {
            // Add the new text and limit to ~500 characters for display
            const newText = (remoteTranscriptionText + " " + cleanText).trim();
            remoteTranscriptionText = newText.length > 500 
                ? "..." + newText.substring(newText.length - 500) 
                : newText;
            
            // Also add to the complete history without limiting length
            remoteTranscriptionHistory = (remoteTranscriptionHistory + " " + cleanText).trim();
                
            // Update via callback
            if (onRemoteTranscription) {
                onRemoteTranscription(remoteTranscriptionText);
                console.log("Updated remote transcription:", remoteTranscriptionText);
            }
        }
    };
    
    /**
     * Setup transcription for a single audio stream
     * @param {MediaStream} stream - The MediaStream to transcribe
     * @param {boolean} isLocal - Whether this is the local stream
     */
    const setupStreamTranscription = (stream, isLocal) => {
        // Extract audio track from the stream
        const audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack) {
            console.error(`No audio track found in ${isLocal ? 'local' : 'remote'} stream`);
            return;
        }
        
        console.log(`Setting up ${isLocal ? 'local' : 'remote'} transcription with audio track:`, audioTrack.label);
        
        // Create a new MediaStream with only the audio track
        const audioStream = new MediaStream([audioTrack]);
        
        // Create MediaRecorder to capture audio
        const mediaRecorder = new MediaRecorder(audioStream, {
            mimeType: 'audio/webm;codecs=opus',
            audioBitsPerSecond: 8000,  // Reduced bitrate
            bitsPerSecond: 8000  // Ensure lowest possible bitrate
        });
        
        // Store reference to media recorder
        if (isLocal) {
            localMediaRecorder = mediaRecorder;
        } else {
            remoteMediaRecorder = mediaRecorder;
        }
        
        // Create WebSocket connection to Deepgram
        const socket = new WebSocket("wss://api.deepgram.com/v1/listen", [
            "token", DEEPGRAM_API_KEY
        ]);
        
        // Store reference to WebSocket
        if (isLocal) {
            localDeepgramSocket = socket;
        } else {
            remoteDeepgramSocket = socket;
        }
        
        // Handle WebSocket open event
        socket.onopen = () => {
            console.log(`${isLocal ? 'Local' : 'Remote'} Deepgram connection opened`);
            
            try {
                // Send configuration
                const configMsg = JSON.stringify({
                    encoding: "audio/webm",
                    sample_rate: 8000,
                    channels: 1,
                    model: "nova",
                    language: "en-US",
                    punctuate: false,
                    interim_results: false,
                    smart_format: false,
                    tier: "nova"
                });
                
                socket.send(configMsg);
                console.log(`Sent configuration to ${isLocal ? 'Local' : 'Remote'} Deepgram:`, configMsg);
                
                // Start recording after sending configuration
                mediaRecorder.start(2000);  // Capture in 2-second chunks instead of 1-second
                console.log(`Started ${isLocal ? 'local' : 'remote'} MediaRecorder`);
            } catch (error) {
                console.error(`Error setting up ${isLocal ? 'local' : 'remote'} Deepgram:`, error);
            }
        };
        
        // Handle WebSocket messages (transcription results)
        socket.onmessage = (message) => {
            try {
                const data = JSON.parse(message.data);
                console.log(`${isLocal ? 'Local' : 'Remote'} Deepgram message:`, data.type || 'No type');
                
                // Check for errors
                if (data.type === "Error") {
                    // Log detailed error information
                    console.error(`${isLocal ? 'Local' : 'Remote'} Deepgram error details:`, {
                        fullData: data,
                        errorCode: data.code,
                        errorMessage: data.message,
                        errorDetails: data.error || data.details,
                        apiKey: DEEPGRAM_API_KEY.substring(0, 8) + '...' // Log partial key for debugging
                    });
                    
                    // Continue despite error - don't return
                }
                
                // Handle different Deepgram response formats
                if (data.type === "Results" || data.type === "Transcript") {
                    // Extract transcript from the response
                    let transcript = "";
                    
                    // Try all possible response structures
                    if (data.channel && data.channel.alternatives && data.channel.alternatives.length > 0) {
                        transcript = data.channel.alternatives[0].transcript || "";
                    } 
                    else if (data.channels && data.channels.length > 0) {
                        // Loop through all channels to find a transcript
                        for (const channel of data.channels) {
                            if (channel.alternatives && channel.alternatives.length > 0) {
                                transcript = channel.alternatives[0].transcript || "";
                                if (transcript) break;
                            }
                        }
                    }
                    else if (data.alternatives && data.alternatives.length > 0) {
                        transcript = data.alternatives[0].transcript || "";
                    }
                    else if (data.transcript) {
                        // Direct transcript property
                        transcript = data.transcript;
                    }
                    
                    if (transcript && transcript.trim()) {
                        console.log(`${isLocal ? 'Local' : 'Remote'} transcript detected:`, transcript);
                        updateTranscription(transcript, isLocal);
                    } else {
                        console.log(`${isLocal ? 'Local' : 'Remote'} received empty transcript`);
                    }
                }
            } catch (error) {
                console.error(`${isLocal ? 'Local' : 'Remote'} Error parsing Deepgram response:`, error, message.data);
            }
        };
        
        // Handle WebSocket errors
        socket.onerror = (error) => {
            console.error(`${isLocal ? 'Local' : 'Remote'} Deepgram WebSocket error:`, {
                error,
                readyState: socket.readyState,
                connectionDetails: {
                    url: "wss://api.deepgram.com/v1/listen",
                    apiKeyFirstChars: DEEPGRAM_API_KEY.substring(0, 8) + '...'
                }
            });
            
            // Try to close the socket if it's still open
            try {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.close();
                }
            } catch (closeError) {
                console.error(`Error closing WebSocket after error:`, closeError);
            }
        };
        
        // Handle WebSocket close
        socket.onclose = (event) => {
            console.log(`${isLocal ? 'Local' : 'Remote'} Deepgram connection closed:`, event.code, event.reason);
            
            // Attempt to reconnect after a short delay if this wasn't a normal closure
            if (event.code !== 1000 && event.code !== 1001) {
                console.log(`Attempting to reconnect ${isLocal ? 'Local' : 'Remote'} Deepgram in 5 seconds...`);
                setTimeout(() => {
                    if ((isLocal && localMediaRecorder) || (!isLocal && remoteMediaRecorder)) {
                        setupStreamTranscription(stream, isLocal);
                    }
                }, 5000);
            }
        };
        
        // Send audio data to Deepgram when available
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
                console.log(`${isLocal ? 'Local' : 'Remote'} audio data available, size:`, event.data.size);
                try {
                    socket.send(event.data);
                } catch (error) {
                    console.error(`Error sending ${isLocal ? 'local' : 'remote'} audio data:`, error);
                }
            }
        };
        
        // Handle MediaRecorder stop
        mediaRecorder.onstop = () => {
            console.log(`${isLocal ? 'Local' : 'Remote'} MediaRecorder stopped`);
            
            // Close WebSocket if still open
            if (socket.readyState === WebSocket.OPEN) {
                socket.close();
            }
        };
        
        // Handle MediaRecorder error
        mediaRecorder.onerror = (error) => {
            console.error(`${isLocal ? 'Local' : 'Remote'} MediaRecorder error:`, error);
        };
    };
    
    /**
     * Start transcription for both local and remote streams
     * @param {MediaStream} localStream - The local MediaStream
     * @param {MediaStream} remoteStream - The remote MediaStream
     */
    const start = (localStream, remoteStream) => {
        // Clean up any existing transcription resources
        cleanup();
        
        console.log("Starting transcription services...");
        
        // Setup local stream transcription
        if (localStream) {
            setupStreamTranscription(localStream, true);
        } else {
            console.error("Local stream not available for transcription");
        }
        
        // Setup remote stream transcription
        if (remoteStream && remoteStream.getAudioTracks().length > 0) {
            setupStreamTranscription(remoteStream, false);
        } else {
            console.log("Remote stream not ready for transcription, will retry in 5 seconds");
            
            // Retry setting up remote transcription after a delay
            // (in case remote tracks aren't available yet)
            transcriptionTimeout = setTimeout(() => {
                if (remoteStream && remoteStream.getAudioTracks().length > 0) {
                    setupStreamTranscription(remoteStream, false);
                } else {
                    console.error("Remote audio track still not available after delay");
                }
            }, 5000);
        }
    };
    
    /**
     * Get the complete transcription history for AI evaluation
     * @returns {Object} The complete transcription history
     */
    const getTranscriptionHistory = () => {
        const history = {
            localTranscriptionHistory: localTranscriptionHistory || "",
            remoteTranscriptionHistory: remoteTranscriptionHistory || ""
        };
        
        console.log("Providing transcription history:", {
            localLength: history.localTranscriptionHistory.length,
            remoteLength: history.remoteTranscriptionHistory.length
        });
        
        return history;
    };
    
    /**
     * Reset transcription history
     */
    const resetTranscriptionHistory = () => {
        console.log("Resetting transcription history");
        localTranscriptionHistory = "";
        remoteTranscriptionHistory = "";
        localTranscriptionText = "";
        remoteTranscriptionText = "";
        
        // Update callbacks with empty text
        if (onLocalTranscription) {
            onLocalTranscription("");
        }
        if (onRemoteTranscription) {
            onRemoteTranscription("");
        }
    };
    
    // Return the public API
    return {
        start,
        cleanup,
        getTranscriptionHistory,
        resetTranscriptionHistory
    };
}; 