// js/auth.js
import { auth } from "./firebase.js";
import { 
    signOut, 
    onAuthStateChanged, 
    setPersistence, 
    browserLocalPersistence, 
    GoogleAuthProvider, 
    signInWithPopup 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const provider = new GoogleAuthProvider();
const ALLOWED_DOMAINS = ['@grupomedcof.com.br', '@medcof.com.br'];

// 1. PERSISTÊNCIA: Faz o Firebase "lembrar" do usuário para sempre neste navegador
setPersistence(auth, browserLocalPersistence);

// 2. FUNÇÃO DE LOGIN (Popup rápido apenas no 1º acesso)
window.loginWithGoogle = async function() {
    const btn = document.getElementById("google-btn");
    const loader = btn?.querySelector(".btn-loader");

    if (auth.currentUser) return;

    if (btn) btn.classList.add("is-loading");
    if (loader) loader.classList.remove("hidden");

    try {
        await signInWithPopup(auth, provider);
        localStorage.setItem("SESSION_ACTIVE_FLAG", "true");
        // O onAuthStateChanged abaixo cuidará da transição suave
    } catch (error) {
        console.error("Erro no login:", error);
        if (btn) btn.classList.remove("is-loading");
        if (loader) loader.classList.add("hidden");
    }
};

// 3. O MONITOR "APOLLO": Ele decide o que mostrar sem recarregar a página
onAuthStateChanged(auth, async (user) => {
    const loginScreen = document.getElementById("login-screen");
    const appContent = document.getElementById("app-content");

    if (user) {
        // Validação de segurança
        const email = user.email || "";
        const isAllowedDomain = ALLOWED_DOMAINS.some(domain => email.endsWith(domain));

        if (!isAllowedDomain) {
            await signOut(auth);
            localStorage.removeItem("SESSION_ACTIVE_FLAG");
            return;
        }

        // ACESSO DIRETO: Se o usuário já está logado, 
        // o login screen nem chega a aparecer para ele
        localStorage.setItem("SESSION_ACTIVE_FLAG", "true");
        
        if (loginScreen) loginScreen.classList.remove("fade-in");
        if (appContent) appContent.classList.add("fade-in");

        setupActivityListeners();
        resetInactivityTimer();
    } else {
        // Se não houver usuário, mostra a tela de login suavemente
        if (appContent) appContent.classList.remove("fade-in");
        if (loginScreen) loginScreen.classList.add("fade-in");
    }
});

// --- MOTOR DE INATIVIDADE (MANTIDO) ---
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