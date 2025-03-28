import { db } from './firebase.jsx';
import { doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { auth } from './firebase.jsx';

/**
 * Get user stats (wins, losses, streak)
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} User stats
 */
export const getUserStats = async (userId) => {
  if (!userId) {
    console.error("Cannot get user stats: userId is undefined");
    return { wins: 0, losses: 0, streak: 0 };
  }
  
  try {
    console.log("Getting stats for user:", userId);
    const userStatsRef = doc(db, 'userStats', userId);
    const userStatsDoc = await getDoc(userStatsRef);
    
    if (userStatsDoc.exists()) {
      const data = userStatsDoc.data();
      console.log("Found user stats:", data);
      return data;
    } else {
      // Create default stats if they don't exist
      console.log("No stats found for user, creating default stats");
      const defaultStats = { wins: 0, losses: 0, streak: 0 };
      
      try {
        await setDoc(userStatsRef, defaultStats);
        console.log("Successfully created default stats");
      } catch (err) {
        console.error("Error creating default stats:", err);
        // Continue without throwing, return default stats anyway
      }
      
      return defaultStats;
    }
  } catch (error) {
    console.error('Error getting user stats:', error);
    return { wins: 0, losses: 0, streak: 0 };
  }
};

/**
 * Update user stats after a debate
 * @param {string} userId - The user ID
 * @param {boolean} isWin - Whether the user won
 * @returns {Promise<Object>} Updated user stats
 */
export const updateUserStats = async (userId, isWin) => {
  if (!userId) {
    console.error("Cannot update user stats: userId is undefined");
    return { wins: 0, losses: 0, streak: 0 };
  }
  
  try {
    console.log(`Updating stats for user ${userId} with ${isWin ? 'win' : 'loss'}`);
    const userStatsRef = doc(db, 'userStats', userId);
    
    // Get current stats or create new ones
    let currentStats;
    try {
      const userStatsDoc = await getDoc(userStatsRef);
      
      if (userStatsDoc.exists()) {
        currentStats = userStatsDoc.data();
        console.log("Current stats before update:", currentStats);
      } else {
        // If no document exists, use default values
        currentStats = { wins: 0, losses: 0, streak: 0 };
        console.log("No previous stats found, using defaults");
      }
    } catch (error) {
      console.error("Error getting current stats:", error);
      currentStats = { wins: 0, losses: 0, streak: 0 };
    }
    
    // Update the stats based on win/loss
    const updatedStats = isWin ? 
      { 
        wins: (currentStats.wins || 0) + 1,
        losses: currentStats.losses || 0,
        streak: (currentStats.streak || 0) + 1
      } : 
      {
        wins: currentStats.wins || 0,
        losses: (currentStats.losses || 0) + 1,
        streak: 0 // Reset streak on loss
      };
    
    // Copy existing displayName if it exists
    if (currentStats.displayName) {
      updatedStats.displayName = currentStats.displayName;
    }
    
    // If there's no displayName yet, try to get it from the current user
    if (!updatedStats.displayName && auth.currentUser) {
      updatedStats.displayName = auth.currentUser.displayName || "User_" + userId.substring(0, 6);
    }
    
    console.log("Saving updated stats:", updatedStats);
    
    try {
      await setDoc(userStatsRef, updatedStats);
      console.log("Successfully updated user stats");
      return updatedStats;
    } catch (error) {
      console.error("Error saving stats to Firestore:", error);
      return updatedStats; // Still return the calculated stats even if save fails
    }
  } catch (error) {
    console.error('Error in updateUserStats:', error);
    // Return default stats on error
    return isWin ? 
      { wins: 1, losses: 0, streak: 1 } : 
      { wins: 0, losses: 1, streak: 0 };
  }
};

/**
 * Get the leaderboard of top users
 * @param {number} limitCount - Number of users to retrieve
 * @returns {Promise<Array>} Leaderboard data
 */
export const getLeaderboard = async (limitCount = 20) => {
  try {
    console.log(`Getting leaderboard with limit: ${limitCount}`);
    const leaderboardQuery = query(
      collection(db, 'userStats'),
      orderBy('wins', 'desc'),
      limit(limitCount)
    );
    
    const leaderboardSnapshot = await getDocs(leaderboardQuery);
    const leaderboard = [];
    
    leaderboardSnapshot.forEach((doc) => {
      const userData = doc.data();
      
      // Check if the user has a displayName in their stats
      let username = userData.displayName || "Unknown User";
      
      leaderboard.push({
        userId: doc.id,
        ...userData,
        displayName: username  // Ensure displayName is included
      });
    });
    
    console.log(`Retrieved ${leaderboard.length} leaderboard entries`);
    return leaderboard;
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    return [];
  }
}; 