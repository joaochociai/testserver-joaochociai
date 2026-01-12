// js/auth.js
import { auth, db } from "./firebase.js";
import { 
    signOut, 
    onAuthStateChanged, 
    setPersistence, 
    browserLocalPersistence, 
    GoogleAuthProvider, 
    signInWithPopup 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Importações para consulta ao Firestore
import { 
    collection, 
    query, 
    where, 
    getDocs 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const provider = new GoogleAuthProvider();

// 1. PERSISTÊNCIA
setPersistence(auth, browserLocalPersistence);

// 2. LOGIN
window.loginWithGoogle = async function() {
    const btn = document.getElementById("google-btn");
    if (auth.currentUser) return;
    if (btn) btn.classList.add("is-loading");

    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Erro no login:", error);
        if (btn) btn.classList.remove("is-loading");
    }
};

// 3. MONITOR DE SEGURANÇA (WHITELIST NA COLEÇÃO 'USERS')
onAuthStateChanged(auth, async (user) => {
    const loginScreen = document.getElementById("login-screen");
    const appContent = document.getElementById("app-content");

    if (user) {
        try {
            // Consulta à coleção 'users' pelo e-mail
            const q = query(collection(db, "users"), where("Email", "==", user.email));
            const querySnapshot = await getDocs(q);

            // Bloqueio se o e-mail não estiver na lista
            if (querySnapshot.empty) {
                throw new Error("Utilizador não autorizado. Contacte o administrador.");
            }

            const userData = querySnapshot.docs[0].data();

            if (userData.status !== "ativo" && userData.status !== true) {
                throw new Error("A sua conta está inativa. Acesso negado.");
            }

            // Define permissões de Admin na interface
            if (userData.role === 'admin') {
                document.body.classList.add('is-admin');
            } else {
                document.body.classList.remove('is-admin');
            }

            localStorage.setItem("SESSION_ACTIVE_FLAG", "true");
            if (loginScreen) loginScreen.style.display = "none";
            if (appContent) {
                appContent.style.display = "block";
                appContent.classList.add("fade-in");
            }

            setupActivityListeners();
            resetInactivityTimer();

        } catch (error) {
            console.error("Erro de Autenticação:", error.message);
            
            if (window.Swal) {
                await Swal.fire({ icon: 'error', title: 'Acesso Negado', text: error.message });
            } else {
                alert(error.message);
            }

            // Expulsa o utilizador não autorizado
            await signOut(auth);
            localStorage.removeItem("SESSION_ACTIVE_FLAG");
            window.location.reload();
        }
    } else {
        if (appContent) appContent.style.display = "none";
        if (loginScreen) loginScreen.style.display = "flex";
        document.body.classList.remove('is-admin');
    }
});

// --- MOTOR DE INATIVIDADE ---
let inactivityTimer;
const INACTIVITY_LIMIT = 30 * 60 * 1000; 

export function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    if (auth.currentUser) inactivityTimer = setTimeout(handleAutoLogout, INACTIVITY_LIMIT);
}

async function handleAutoLogout() {
    localStorage.removeItem("SESSION_ACTIVE_FLAG");
    try { await signOut(auth); window.location.reload(); } catch (e) { console.error(e); }
}

export function setupActivityListeners() {
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    events.forEach(e => window.addEventListener(e, resetInactivityTimer, true));
}