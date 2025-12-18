// js/permissions.js
import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export async function getUserPermissions(uid) {
    const snap = await getDoc(doc(db, "users", uid));

    if (!snap.exists()) {
        console.warn("Usuário sem documento de permissões.");
        return {
            role: "normal",
            sectors: []
        };
    }

    const u = snap.data();
    return {
        role: u.role || "normal",
        sectors: u.sectors || []
    };
}