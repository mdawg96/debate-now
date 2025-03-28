/**
 * This is a utility script to fix missing usernames in the userStats collection
 * It can be run once from an admin page to update all user records
 */
import { db, auth } from './firebase.jsx';
import { collection, getDocs, doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';

/**
 * Update all userStats records to include displayNames
 * This should be run by an admin or during app initialization to fix missing names
 */
export const fixMissingUsernames = async () => {
  try {
    console.log("Starting to fix missing usernames in userStats collection");
    
    // Get all user stats
    const userStatsRef = collection(db, 'userStats');
    const snapshot = await getDocs(userStatsRef);
    
    let updatedCount = 0;
    let skippedCount = 0;
    
    // Get current user's info if available
    const currentUser = auth.currentUser;
    
    // Process each document
    for (const statsDoc of snapshot.docs) {
      const userId = statsDoc.id;
      const statsData = statsDoc.data();
      
      // Skip if already has a proper displayName (not a generated one)
      if (statsData.displayName && !statsData.displayName.startsWith("User_")) {
        console.log(`User ${userId} already has a displayName: ${statsData.displayName}`);
        skippedCount++;
        continue;
      }
      
      // Special handling for current user - use their auth displayName
      if (currentUser && currentUser.uid === userId && currentUser.displayName) {
        console.log(`Using current user's displayName for ${userId}: ${currentUser.displayName}`);
        
        // Update the userStats document with the current user's displayName
        await updateDoc(doc(db, 'userStats', userId), {
          displayName: currentUser.displayName
        });
        
        // Also create/update a users collection document for future lookups
        await setDoc(doc(db, 'users', userId), {
          displayName: currentUser.displayName,
          email: currentUser.email,
          updatedAt: new Date().toISOString()
        }, { merge: true });
        
        console.log(`Updated displayName for ${userId} to: ${currentUser.displayName}`);
        updatedCount++;
        continue;
      }
      
      // Try to get user data from the users collection
      try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        
        if (userDoc.exists()) {
          const userData = userDoc.data();
          
          // Look for a username in various fields
          const displayName = userData.displayName || userData.username || userData.name || `User_${userId.substring(0, 6)}`;
          
          // Update the userStats document
          await updateDoc(doc(db, 'userStats', userId), {
            displayName: displayName
          });
          
          console.log(`Updated displayName for ${userId} to: ${displayName}`);
          updatedCount++;
        } else {
          console.log(`No user document found for ${userId}, using fallback name`);
          await updateDoc(doc(db, 'userStats', userId), {
            displayName: `User_${userId.substring(0, 6)}`
          });
          updatedCount++;
        }
      } catch (error) {
        console.error(`Error updating username for ${userId}:`, error);
      }
    }
    
    console.log(`Completed username updates. Updated: ${updatedCount}, Skipped: ${skippedCount}`);
    return { updatedCount, skippedCount };
    
  } catch (error) {
    console.error("Error in fixMissingUsernames:", error);
    throw error;
  }
};

export default fixMissingUsernames; 