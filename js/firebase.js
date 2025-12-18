// js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
export const db = getFirestore(app);
