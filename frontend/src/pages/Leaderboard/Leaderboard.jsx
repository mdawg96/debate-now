import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getLeaderboard } from '../../services/statsService';
import { auth, db } from '../../services/firebase.jsx';
import { doc, getDoc } from 'firebase/firestore';
import './Leaderboard.css';

function Leaderboard() {
    const [leaderboardData, setLeaderboardData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const navigate = useNavigate();
    
    useEffect(() => {
        fetchLeaderboardData();
    }, []);
    
    const fetchLeaderboardData = async () => {
        try {
            setIsLoading(true);
            setError(null);
            
            // Get the leaderboard data
            const data = await getLeaderboard();
            setLeaderboardData(data);
        } catch (error) {
            console.error('Error fetching leaderboard:', error);
            setError('Failed to load leaderboard data. Please try again later.');
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleBackClick = () => {
        navigate('/');
    };
    
    return (
        <div className="leaderboard-container">
            <div className="leaderboard-header">
                <button className="back-button" onClick={handleBackClick}>Back to Home</button>
                <h1>Debate Champions</h1>
                <p>Top debaters ranked by wins</p>
            </div>
            
            {isLoading ? (
                <div className="loading-container">
                    <div className="loading-spinner"></div>
                    <p>Loading leaderboard data...</p>
                </div>
            ) : error ? (
                <div className="error-message">
                    <p>{error}</p>
                    <button onClick={fetchLeaderboardData}>Try Again</button>
                </div>
            ) : (
                <div className="leaderboard-table-container">
                    <table className="leaderboard-table">
                        <thead>
                            <tr>
                                <th>Rank</th>
                                <th>Username</th>
                                <th>Wins</th>
                                <th>Losses</th>
                                <th>Win %</th>
                                <th>Current Streak</th>
                            </tr>
                        </thead>
                        <tbody>
                            {leaderboardData.length > 0 ? (
                                leaderboardData.map((user, index) => {
                                    const winPercentage = user.wins + user.losses > 0 
                                        ? ((user.wins / (user.wins + user.losses)) * 100).toFixed(1) 
                                        : "0.0";
                                    
                                    return (
                                        <tr key={user.userId} className={index < 3 ? `top-${index + 1}` : ""}>
                                            <td>{index + 1}</td>
                                            <td>{user.displayName || "Unknown User"}</td>
                                            <td>{user.wins}</td>
                                            <td>{user.losses}</td>
                                            <td>{winPercentage}%</td>
                                            <td>{user.streak}</td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan="6" className="no-data">No leaderboard data available yet</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
            
            <div className="leaderboard-footer">
                <p>Win a debate to get on the leaderboard!</p>
                <button className="refresh-button" onClick={fetchLeaderboardData}>Refresh Data</button>
            </div>
        </div>
    );
}

export default Leaderboard; 