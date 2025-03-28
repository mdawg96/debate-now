import React, { useState, useEffect, useRef } from 'react';
import './ChatBox.css';

const ChatBox = ({ 
    matchId, 
    userId, 
    isInitiator, 
    currentSpeaker, 
    debateStage,
    onSendMessage,
    useWebRTC = false
}) => {
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const messagesEndRef = useRef(null);
    
    // Scroll to bottom when new messages arrive
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };
    
    useEffect(() => {
        scrollToBottom();
    }, [messages]);
    
    // Handle sending a new message
    const handleSendMessage = (e) => {
        e.preventDefault();
        
        if (!newMessage.trim()) return;
        
        const messageData = {
            text: newMessage.trim(),
            timestamp: new Date().toISOString(),
            isInitiator,
            debateStage: debateStage?.name || 'Unknown'
        };
        
        // If using WebRTC, send through data channel
        if (useWebRTC && onSendMessage) {
            onSendMessage(messageData);
            // Add message to local state immediately for UI update
            setMessages(prev => [...prev, messageData]);
        }
        
        setNewMessage('');
    };
    
    // Handle receiving a new message
    useEffect(() => {
        if (!useWebRTC) return;
        
        // Listen for new messages from parent component
        const handleNewMessage = (message) => {
            setMessages(prev => [...prev, message]);
        };
        
        // Set up listener
        window.addEventListener('webrtc-chat-message', handleNewMessage);
        
        return () => {
            window.removeEventListener('webrtc-chat-message', handleNewMessage);
        };
    }, [useWebRTC]);
    
    return (
        <div className="chat-box">
            <div className="chat-header">
                <h3>{currentSpeaker} Turn</h3>
                {debateStage && (
                    <p className="debate-stage">{debateStage.name}</p>
                )}
            </div>
            
            <div className="messages-container">
                {messages.map((message, index) => (
                    <div 
                        key={index} 
                        className={`message ${message.isInitiator === isInitiator ? 'sent' : 'received'}`}
                    >
                        <div className="message-content">
                            {message.text}
                        </div>
                        <div className="message-timestamp">
                            {new Date(message.timestamp).toLocaleTimeString()}
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>
            
            <form onSubmit={handleSendMessage} className="message-input">
                <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type your message..."
                />
                <button type="submit">Send</button>
            </form>
        </div>
    );
};

export default ChatBox; 