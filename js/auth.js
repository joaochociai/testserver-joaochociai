// js/auth.js
import { auth } from "./firebase.js";
import { 
    signOut, 
    onAuthStateChanged, 
    setPersistence, 
    browserSessionPersistence,
    GoogleAuthProvider, 
    signInWithPopup 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const provider = new GoogleAuthProvider();

// --- CONFIGURAÇÃO DE DOMÍNIOS PERMITIDOS ---
const ALLOWED_DOMAINS = ['@grupomedcof.com.br', '@medcof.com.br'];

// --- 1. CONFIGURAÇÃO DE PERSISTÊNCIA ---
setPersistence(auth, browserSessionPersistence).catch(e => console.error("Erro persistência:", e));

// --- 2. MOTOR DE INATIVIDADE ---
let inactivityTimer;
const INACTIVITY_LIMIT = 15 * 60 * 1000; 

export function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    if (auth.currentUser) {
        inactivityTimer = setTimeout(handleAutoLogout, INACTIVITY_LIMIT);
    }
}

async function handleAutoLogout() {
    sessionStorage.removeItem("SESSION_ACTIVE_FLAG");
    try {
        await signOut(auth);
        if (typeof Swal !== 'undefined') {
            await Swal.fire({
                title: "Sessão Expirada",
                text: "Você foi deslogado automaticamente devido à inatividade.",
                icon: "warning",
                confirmButtonText: "Entrar Novamente"
            });
        }
        window.location.reload(); 
    } catch (error) { console.error("Erro no logout automático:", error); }
}

export function setupActivityListeners() {
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    events.forEach(e => window.addEventListener(e, resetInactivityTimer, true));
}

// --- 3. LÓGICA DE LOGIN (GOOGLE) ---
window.loginWithGoogle = async function() {
    const msg = document.getElementById("login-message");
    try {
        sessionStorage.setItem("SESSION_ACTIVE_FLAG", "true");
        await signInWithPopup(auth, provider);
        console.log("✅ Login Google iniciado...");
    } catch (err) {
        console.error("Erro Google Login:", err);
        sessionStorage.removeItem("SESSION_ACTIVE_FLAG");
        if (msg) msg.textContent = "Erro ao entrar com Google.";
    }
};

// --- 4. MONITOR DE SEGURANÇA E FILTRO DE DOMÍNIO ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const email = user.email || "";
        // Verifica se o e-mail termina com algum dos domínios permitidos
        const isAllowedDomain = ALLOWED_DOMAINS.some(domain => email.endsWith(domain));

        if (!isAllowedDomain) {
            console.error("🚫 Acesso negado: Domínio não autorizado (" + email + ")");
            sessionStorage.removeItem("SESSION_ACTIVE_FLAG");
            
            await signOut(auth);

            if (typeof Swal !== 'undefined') {
                await Swal.fire({
                    title: "Acesso Negado",
                    text: "Por favor, utilize seu e-mail corporativo (@medcof.com.br ou @grupomedcof.com.br) para acessar este sistema.",
                    icon: "error",
                    confirmButtonText: "Entendido"
                });
            }
            return;
        }

        // Se o domínio for válido, verifica o carimbo de sessão
        const isSessionValid = sessionStorage.getItem("SESSION_ACTIVE_FLAG");
        if (!isSessionValid) {
            console.warn("⚠️ Sessão sem carimbo. Bloqueando...");
            await signOut(auth);
            return;
        }

        console.log("🛡️ Segurança: Usuário corporativo validado.");
        setupActivityListeners();
        resetInactivityTimer();
    } else {
        clearTimeout(inactivityTimer);
    }
});