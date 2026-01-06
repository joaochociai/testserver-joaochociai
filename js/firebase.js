// js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
// Importamos as novas funções de cache
import { 
    initializeFirestore, 
    persistentLocalCache, 
    persistentMultipleTabManager 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyA9EnKileAfQkKwN8G1li6VNLePlmLqOyg",
    authDomain: "agendamento-link-912a3.firebaseapp.com",
    projectId: "agendamento-link-912a3",
    storageBucket: "agendamento-link-912a3.firebasestorage.app",
    messagingSenderId: "825610948854",
    appId: "1:825610948854:web:00e079107d10673d895cd7",
    measurementId: "G-839M7L1ZBL"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Inicializa o Firestore com o novo modelo de cache persistente (v10+)
// Isso substitui o enableIndexedDbPersistence e remove o aviso do console
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager() // Permite sincronização entre múltiplas abas abertas
  })
});