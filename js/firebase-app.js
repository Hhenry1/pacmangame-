// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-analytics.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getDatabase, ref, set, get, child, update, onValue, remove, query, orderByChild, limitToLast } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyAXwDW5rM2ElVYryEtYvdUpqe1pSreJzco",
  authDomain: "pacman-b5fb7.firebaseapp.com",
  databaseURL: "https://pacman-b5fb7-default-rtdb.firebaseio.com",
  projectId: "pacman-b5fb7",
  storageBucket: "pacman-b5fb7.firebasestorage.app",
  messagingSenderId: "1018328013266",
  appId: "1:1018328013266:web:8b5a7e24bf642ae4d8d00b",
  measurementId: "G-CY4DZJPNM5"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getDatabase(app);

// Application State
let currentUser = null;
let userHighScore = 0;
let currentRoomCode = null;
let isHost = false;
let roomListenerUnsubscribe = null;
let lastReportedScore = 0;

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    setupUIListeners();
    setupAuth();
    fetchGlobalLeaderboard();
    startGameStateTracker();
});

// ==========================================
// UI EVENT LISTENERS
// ==========================================
function setupUIListeners() {
    // Auth buttons
    const googleBtn = document.getElementById("google-signin-btn");
    const signoutBtn = document.getElementById("signout-btn");
    if (googleBtn) googleBtn.addEventListener("click", handleGoogleSignIn);
    if (signoutBtn) signoutBtn.addEventListener("click", handleSignOut);

    // Main Action Buttons
    const startTournamentBtn = document.getElementById("btn-start-tournament");
    const playCasualBtn = document.getElementById("btn-play-casual");
    const joinTournamentBtn = document.getElementById("btn-join-tournament");

    if (startTournamentBtn) {
        startTournamentBtn.addEventListener("click", () => {
            if (!currentUser) {
                alert("Please sign in with Google first to start a tournament!");
                return;
            }
            createTournamentRoom();
        });
    }

    if (playCasualBtn) {
        playCasualBtn.addEventListener("click", () => {
            // Start casual game without modifying original engine
            if (typeof window.initGame === "function") {
                window.initGame(true);
            } else {
                console.error("Original Pac-Man engine initGame() not found.");
            }
        });
    }

    if (joinTournamentBtn) {
        joinTournamentBtn.addEventListener("click", () => {
            if (!currentUser) {
                alert("Please sign in with Google first to join a tournament!");
                return;
            }
            openJoinModal();
        });
    }

    // Modal Close Buttons
    const closeJoinBtn = document.getElementById("close-join-modal");
    const leaveLobbyBtn = document.getElementById("leave-lobby-btn");
    if (closeJoinBtn) closeJoinBtn.addEventListener("click", closeJoinModal);
    if (leaveLobbyBtn) leaveLobbyBtn.addEventListener("click", leaveTournamentLobby);

    // Join Tournament Confirm Button
    const confirmJoinBtn = document.getElementById("confirm-join-btn");
    if (confirmJoinBtn) {
        confirmJoinBtn.addEventListener("click", () => {
            const codeInput = document.getElementById("join-code-input");
            const code = codeInput ? codeInput.value.trim().toUpperCase() : "";
            if (code.length < 4) {
                showJoinError("Please enter a valid 6-character server code.");
                return;
            }
            joinTournamentRoom(code);
        });
    }

    // Lobby Play Match Button
    const playMatchBtn = document.getElementById("btn-play-tournament-match");
    if (playMatchBtn) {
        playMatchBtn.addEventListener("click", () => {
            closeLobbyModalOnly();
            if (typeof window.initGame === "function") {
                window.initGame(true);
            }
        });
    }

    // Host End Tournament Button
    const endTournamentBtn = document.getElementById("btn-end-tournament");
    if (endTournamentBtn) {
        endTournamentBtn.addEventListener("click", () => {
            if (confirm("Are you sure you want to end this tournament for all players?")) {
                endTournamentRoom();
            }
        });
    }
}

// ==========================================
// GOOGLE AUTHENTICATION
// ==========================================
function setupAuth() {
    onAuthStateChanged(auth, async (user) => {
        const signinBtn = document.getElementById("google-signin-btn");
        const userProfile = document.getElementById("user-profile");
        const userAvatar = document.getElementById("user-avatar");
        const userName = document.getElementById("user-name");
        const userHighScoreElem = document.getElementById("user-highscore");

        if (user) {
            currentUser = user;
            if (signinBtn) {
                signinBtn.style.setProperty("display", "none", "important");
                signinBtn.classList.add("hidden");
            }
            if (userProfile) userProfile.style.display = "flex";
            if (userAvatar) userAvatar.src = user.photoURL || "https://api.dicebear.com/7.x/bottts/svg?seed=" + user.uid;
            if (userName) userName.textContent = user.displayName || "Player";

            // Load high score from Firebase
            await loadUserHighScore(user.uid, user.displayName, user.photoURL);
            if (userHighScoreElem) userHighScoreElem.textContent = `High: ${userHighScore}`;
        } else {
            currentUser = null;
            userHighScore = 0;
            if (signinBtn) {
                signinBtn.style.setProperty("display", "inline-flex", "important");
                signinBtn.classList.remove("hidden");
            }
            if (userProfile) userProfile.style.display = "none";
        }
    });
}

async function handleGoogleSignIn() {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Google Sign-In Error:", error);
        alert("Authentication failed: " + error.message);
    }
}

async function handleSignOut() {
    try {
        if (currentRoomCode) {
            await leaveTournamentLobby();
        }
        await signOut(auth);
    } catch (error) {
        console.error("Sign Out Error:", error);
    }
}

async function loadUserHighScore(uid, name, photo) {
    try {
        const userRef = ref(db, `users/${uid}`);
        const snapshot = await get(userRef);
        if (snapshot.exists()) {
            const data = snapshot.val();
            userHighScore = data.highScore || 0;
            if (typeof window.HIGHSCORE !== "undefined" && userHighScore > window.HIGHSCORE) {
                window.HIGHSCORE = userHighScore;
            }
        } else {
            // Create new user record
            await set(userRef, {
                uid: uid,
                displayName: name || "Anonymous Pac",
                photoURL: photo || "",
                highScore: 0,
                updatedAt: Date.now()
            });
            userHighScore = 0;
        }
        const highElem = document.getElementById("user-highscore");
        if (highElem) highElem.textContent = `High: ${userHighScore}`;
    } catch (err) {
        console.error("Error loading high score:", err);
    }
}

async function updateHighScoreInFirebase(newScore) {
    if (!currentUser || newScore <= userHighScore) return;
    userHighScore = newScore;
    const highElem = document.getElementById("user-highscore");
    if (highElem) highElem.textContent = `High: ${userHighScore}`;

    try {
        const userRef = ref(db, `users/${currentUser.uid}`);
        await update(userRef, {
            highScore: newScore,
            displayName: currentUser.displayName || "Anonymous Pac",
            photoURL: currentUser.photoURL || "",
            updatedAt: Date.now()
        });
        fetchGlobalLeaderboard();
    } catch (err) {
        console.error("Error saving high score to Firebase:", err);
    }
}

// ==========================================
// GLOBAL LEADERBOARD
// ==========================================
function fetchGlobalLeaderboard() {
    const topScoresRef = query(ref(db, "users"), orderByChild("highScore"), limitToLast(10));
    onValue(topScoresRef, (snapshot) => {
        const tbody = document.getElementById("global-leaderboard-body");
        if (!tbody) return;

        if (!snapshot.exists()) {
            tbody.innerHTML = '<tr><td colspan="2" style="text-align:center;">No scores recorded yet. Play a game!</td></tr>';
            return;
        }

        const players = [];
        snapshot.forEach((childSnap) => {
            players.push(childSnap.val());
        });
        // Sort descending
        players.sort((a, b) => (b.highScore || 0) - (a.highScore || 0));

        let html = "";
        players.forEach((p, idx) => {
            const rank = idx + 1;
            const name = p.displayName ? p.displayName.split(" ")[0] : "Player";
            const score = p.highScore || 0;
            html += `<tr>
                <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;">
                    <span style="display:inline-block;width:20px;">#${rank}</span> ${name}
                </td>
                <td style="text-align:right;font-family:monospace;">${score}</td>
            </tr>`;
        });
        tbody.innerHTML = html;
    });
}

// ==========================================
// TOURNAMENTS (10 PLAYER LIMIT)
// ==========================================
function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "PAC-";
    for (let i = 0; i < 4; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function createTournamentRoom() {
    if (!currentUser) return;
    const roomCode = generateRoomCode();
    currentRoomCode = roomCode;
    isHost = true;

    const roomRef = ref(db, `tournaments/${roomCode}`);
    const hostData = {
        code: roomCode,
        hostId: currentUser.uid,
        hostName: currentUser.displayName || "Host",
        status: "waiting",
        playerCount: 1,
        maxPlayers: 10,
        createdAt: Date.now(),
        participants: {
            [currentUser.uid]: {
                uid: currentUser.uid,
                displayName: currentUser.displayName || "Player",
                photoURL: currentUser.photoURL || "",
                score: 0,
                joinedAt: Date.now()
            }
        }
    };

    try {
        await set(roomRef, hostData);
        openLobbyModal(roomCode, true);
        subscribeToRoomUpdates(roomCode);
    } catch (err) {
        console.error("Error creating room:", err);
        alert("Failed to create tournament server room.");
    }
}

function openJoinModal() {
    const modal = document.getElementById("join-modal");
    const errElem = document.getElementById("join-error-msg");
    const inputElem = document.getElementById("join-code-input");
    if (errElem) errElem.style.display = "none";
    if (inputElem) inputElem.value = "";
    if (modal) modal.classList.remove("hidden");
}

function closeJoinModal() {
    const modal = document.getElementById("join-modal");
    if (modal) modal.classList.add("hidden");
}

function showJoinError(msg) {
    const errElem = document.getElementById("join-error-msg");
    if (errElem) {
        errElem.textContent = msg;
        errElem.style.display = "block";
    }
}

async function joinTournamentRoom(code) {
    if (!currentUser) return;
    const roomRef = ref(db, `tournaments/${code}`);
    
    try {
        const snap = await get(roomRef);
        if (!snap.exists()) {
            showJoinError("Server room not found! Check the code.");
            return;
        }

        const data = snap.val();
        if (data.status === "ended") {
            showJoinError("This tournament has already ended.");
            return;
        }

        const participants = data.participants || {};
        const isAlreadyInRoom = !!participants[currentUser.uid];
        const currentCount = Object.keys(participants).length;

        // Strict 10 Person Limit
        if (!isAlreadyInRoom && currentCount >= 10) {
            showJoinError("TOURNAMENT FULL! (Strict limit of 10 players)");
            return;
        }

        // Add user to room
        if (!isAlreadyInRoom) {
            const userParticipantRef = ref(db, `tournaments/${code}/participants/${currentUser.uid}`);
            await set(userParticipantRef, {
                uid: currentUser.uid,
                displayName: currentUser.displayName || "Player",
                photoURL: currentUser.photoURL || "",
                score: 0,
                joinedAt: Date.now()
            });
            await update(roomRef, {
                playerCount: currentCount + 1
            });
        }

        currentRoomCode = code;
        isHost = (data.hostId === currentUser.uid);
        closeJoinModal();
        openLobbyModal(code, isHost);
        subscribeToRoomUpdates(code);
    } catch (err) {
        console.error("Error joining room:", err);
        showJoinError("Error joining room: " + err.message);
    }
}

function openLobbyModal(code, host) {
    const modal = document.getElementById("lobby-modal");
    const codeElem = document.getElementById("lobby-room-code");
    const endBtn = document.getElementById("btn-end-tournament");
    const playBtn = document.getElementById("btn-play-tournament-match");
    const leaveBtn = document.getElementById("leave-lobby-btn");

    if (codeElem) codeElem.textContent = code;
    if (endBtn) endBtn.style.display = host ? "inline-block" : "none";
    if (playBtn) playBtn.style.display = host ? "none" : "inline-block";
    if (leaveBtn) leaveBtn.style.display = host ? "none" : "inline-block";
    if (modal) modal.classList.remove("hidden");
}

function closeLobbyModalOnly() {
    const modal = document.getElementById("lobby-modal");
    if (modal) modal.classList.add("hidden");
}

async function leaveTournamentLobby() {
    if (!currentRoomCode || !currentUser) {
        closeLobbyModalOnly();
        return;
    }
    const code = currentRoomCode;
    const uid = currentUser.uid;

    if (roomListenerUnsubscribe) {
        roomListenerUnsubscribe();
        roomListenerUnsubscribe = null;
    }

    try {
        if (isHost) {
            await endTournamentRoom();
        } else {
            const userParticipantRef = ref(db, `tournaments/${code}/participants/${uid}`);
            await remove(userParticipantRef);
            
            const roomRef = ref(db, `tournaments/${code}`);
            const snap = await get(roomRef);
            if (snap.exists()) {
                const count = snap.val().playerCount || 1;
                await update(roomRef, { playerCount: Math.max(0, count - 1) });
            }
        }
    } catch (err) {
        console.error("Error leaving lobby:", err);
    }

    currentRoomCode = null;
    isHost = false;
    closeLobbyModalOnly();
}

async function endTournamentRoom() {
    if (!currentRoomCode) return;
    const roomRef = ref(db, `tournaments/${currentRoomCode}`);
    try {
        await update(roomRef, { status: "ended" });
        await remove(roomRef);
    } catch (err) {
        console.error("Error ending tournament:", err);
    }
    currentRoomCode = null;
    isHost = false;
    closeLobbyModalOnly();
    alert("🛑 Tournament ended! Room code invalidated.");
}

function subscribeToRoomUpdates(code) {
    if (roomListenerUnsubscribe) {
        roomListenerUnsubscribe();
    }

    const roomRef = ref(db, `tournaments/${code}`);
    roomListenerUnsubscribe = onValue(roomRef, (snapshot) => {
        if (!snapshot.exists() || snapshot.val().status === "ended") {
            alert("Tournament has been ended by the host or closed.");
            currentRoomCode = null;
            isHost = false;
            closeLobbyModalOnly();
            if (roomListenerUnsubscribe) {
                roomListenerUnsubscribe();
                roomListenerUnsubscribe = null;
            }
            return;
        }

        const data = snapshot.val();
        const isActualHost = (currentUser && currentUser.uid === data.hostId);
        const endBtn = document.getElementById("btn-end-tournament");
        const playBtn = document.getElementById("btn-play-tournament-match");
        const leaveBtn = document.getElementById("leave-lobby-btn");
        if (endBtn) endBtn.style.display = isActualHost ? "inline-block" : "none";
        if (playBtn) playBtn.style.display = isActualHost ? "none" : "inline-block";
        if (leaveBtn) leaveBtn.style.display = isActualHost ? "none" : "inline-block";

        const participants = data.participants || {};
        const playersArray = Object.values(participants);
        
        // Update player count badge
        const countElem = document.getElementById("lobby-player-count");
        if (countElem) countElem.textContent = playersArray.length;

        // Render participant list
        const listElem = document.getElementById("lobby-participants-list");
        if (listElem) {
            listElem.innerHTML = playersArray.map(p => `
                <li style="display:flex;align-items:center;gap:8px;border-bottom:1px solid #222;padding:4px 0;">
                    <span style="color:#4adecb;">●</span>
                    <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.displayName || "Player"}</span>
                    ${p.uid === data.hostId ? '<span style="background:#fff200;color:#000;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:bold;">HOST</span>' : ''}
                </li>
            `).join("");
        }

        // Render Room Leaderboard
        const tbody = document.getElementById("lobby-leaderboard-body");
        if (tbody) {
            playersArray.sort((a, b) => (b.score || 0) - (a.score || 0));
            tbody.innerHTML = playersArray.map((p, idx) => `
                <tr>
                    <td>#${idx + 1}</td>
                    <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;">${p.displayName || "Player"}</td>
                    <td style="font-family:monospace;font-weight:bold;color:#fff200;">${p.score || 0}</td>
                </tr>
            `).join("");
        }
    });
}

// ==========================================
// GAME LOOP & SCORE TRACKER
// ==========================================
function startGameStateTracker() {
    setInterval(() => {
        if (typeof window.SCORE === "number" && window.SCORE > lastReportedScore) {
            lastReportedScore = window.SCORE;
            
            // Check global high score
            if (lastReportedScore > userHighScore) {
                updateHighScoreInFirebase(lastReportedScore);
            }

            // Update room live score if in tournament
            if (currentRoomCode && currentUser) {
                const userScoreRef = ref(db, `tournaments/${currentRoomCode}/participants/${currentUser.uid}/score`);
                set(userScoreRef, lastReportedScore).catch(err => console.error("Error updating room score:", err));
            }
        }

        // If new game started, reset reported score
        if (typeof window.SCORE === "number" && window.SCORE === 0 && lastReportedScore > 0) {
            lastReportedScore = 0;
        }
    }, 1000);
}

window.confirmEndTournament = () => {
    if (confirm("Are you sure you want to end this tournament for all players?")) {
        endTournamentRoom();
    }
};
window.leaveTournamentLobby = leaveTournamentLobby;
window.startTournamentGame = () => {
    closeLobbyModalOnly();
    if (typeof window.initGame === "function") {
        window.initGame(true);
    }
};
