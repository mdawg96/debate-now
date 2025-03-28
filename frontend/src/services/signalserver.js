import { db } from './firebase.jsx';
import { collection, doc, setDoc, updateDoc, onSnapshot, addDoc, getDoc } from 'firebase/firestore';

export const servers = {
    iceServers: [
        {
            urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
        },
    ],
    iceCandidatePoolSize: 10,
};

export const createPeerConnection = () => {
    return new RTCPeerConnection(servers);
};

export const setupCallConnection = async (pc, localStream, remoteStream, matchId) => {
    // Add local tracks to peer connection
    localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
    });

    // Handle remote tracks
    pc.ontrack = event => {
        console.log('Remote track received:', event.streams[0]);
        event.streams[0].getTracks().forEach(track => {
            console.log('Adding track to remote stream:', track);
            remoteStream.addTrack(track);
        });
    };

    const matchRef = doc(db, 'matches', matchId);
    const offerCandidatesRef = collection(matchRef, 'offerCandidates');
    const answerCandidatesRef = collection(matchRef, 'answerCandidates');

    return { matchRef, offerCandidatesRef, answerCandidatesRef };
};

export const createOffer = async (pc, matchRef) => {
    try {
        const offerDescription = await pc.createOffer();
        await pc.setLocalDescription(offerDescription);

        const offer = {
            sdp: offerDescription.sdp,
            type: offerDescription.type,
        };

        await updateDoc(matchRef, { offer });
        console.log('Offer created and saved to Firestore');
    } catch (error) {
        console.error('Error creating offer:', error);
        throw error;
    }
};

export const handleAnswer = async (pc, matchRef) => {
    try {
        const unsubscribe = onSnapshot(matchRef, (snapshot) => {
            const data = snapshot.data();
            if (!pc.currentRemoteDescription && data?.answer) {
                console.log('Answer received:', data.answer);
                const answerDescription = new RTCSessionDescription(data.answer);
                pc.setRemoteDescription(answerDescription)
                    .catch(err => console.error('Error setting remote description:', err));
            }
        });
        return unsubscribe;
    } catch (error) {
        console.error('Error handling answer:', error);
        throw error;
    }
};

export const createAnswer = async (pc, matchRef) => {
    try {
        const matchData = (await getDoc(matchRef)).data();
        
        if (!matchData || !matchData.offer) {
            console.error('No offer found in match data');
            throw new Error('No offer available. The initiator may have disconnected.');
        }
        
        const offerDescription = matchData.offer;
        console.log('Setting remote description with offer:', offerDescription);
        await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

        const answerDescription = await pc.createAnswer();
        console.log('Created answer:', answerDescription);
        await pc.setLocalDescription(answerDescription);

        const answer = {
            type: answerDescription.type,
            sdp: answerDescription.sdp,
        };

        await updateDoc(matchRef, { answer });
        console.log('Answer created and saved to Firestore');
    } catch (error) {
        console.error('Error creating answer:', error);
        throw error;
    }
};

