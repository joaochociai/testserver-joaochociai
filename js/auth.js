import { auth } from "../firebase.js";
import { 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut,
    setPersistence, 
    browserSessionPersistence 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import { getUserPermissions } from "../permissions.js";
import { showMenusByPermission, loadModulesBySector } from "../ui.js";

window.currentUser = null;

// Configura persistência global (boa prática)
setPersistence(auth, browserSessionPersistence).catch(console.error);

// ------------------------------------------------------------------
// 1. EVENTO DE LOGIN (CRIA O CARIMBO)
// ------------------------------------------------------------------
document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("login-email").value;
    const pass  = document.getElementById("login-password").value;

    try {
        await setPersistence(auth, browserSessionPersistence);
        const cred = await signInWithEmailAndPassword(auth, email, pass);
        
        // --- O PULO DO GATO ---
        // Cria a "Trava de Sessão". Isso sobrevive ao F5, mas morre ao fechar a aba.
        sessionStorage.setItem("SESSION_ACTIVE_FLAG", "true");
        // ----------------------

        console.log("Login OK:", cred.user.uid);
        
    } catch (e) {
        console.error(e);
        document.getElementById("login-message").textContent = "E-mail ou senha inválidos.";
    }
});

// ------------------------------------------------------------------
// 2. MONITOR DE AUTENTICAÇÃO (VERIFICA O CARIMBO)
// ------------------------------------------------------------------
onAuthStateChanged(auth, async (user) => {
    
    // A. Se não tem usuário no Firebase, mostra login
    if (!user) {
        showLoginScreen();
        return;
    }

    // B. VERIFICAÇÃO DE SEGURANÇA (TRAVA)
    // Se o usuário está logado no Firebase, mas não tem o carimbo no SessionStorage,
    // significa que ele fechou o navegador e o navegador "restaurou" o login indevidamente.
    const isSessionValid = sessionStorage.getItem("SESSION_ACTIVE_FLAG");

    if (!isSessionValid) {
        console.warn("Sessão restaurada indevidamente pelo navegador. Forçando Logout...");
        await signOut(auth); // Chuta o usuário para fora
        showLoginScreen();
        return;
    }

    // C. Se passou pela trava (é um F5 ou navegação normal), carrega o sistema
    console.log("Sessão válida e ativa.");
    
    const perms = await getUserPermissions(user.uid);
    window.currentUser = perms;

    document.getElementById("login-screen").style.display = "none";
    document.getElementById("app-content").style.display = "block";

    showMenusByPermission(perms);
    loadModulesBySector(perms);
});

// Função auxiliar apenas para limpar o código visualmente
function showLoginScreen() {
    document.getElementById("login-screen").style.display = "flex";
    document.getElementById("app-content").style.display = "none";
    // Limpa qualquer rastro de permissão
    window.currentUser = null;
}

// Logout Manual
window.logoutSystem = function() {
    // Ao sair manualmente, removemos o carimbo
    sessionStorage.removeItem("SESSION_ACTIVE_FLAG");
    signOut(auth);
};