import { db, auth } from "./firebase.js";
import { collection, getDocs, doc, getDoc, deleteDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let editingUserId = null;

// Exposição global para botões HTML
window.switchUserTab = function(tabName) {
    // Esconde todos os painéis
    document.querySelectorAll('.drawer-pane').forEach(p => p.classList.add('hidden'));
    // Desativa todos os botões de aba
    document.querySelectorAll('.drawer-tab-link').forEach(l => l.classList.remove('active'));
    
    // Mostra o selecionado
    const target = document.getElementById(`user-tab-${tabName}`);
    if (target) target.classList.remove('hidden');
    
    // Ativa o botão clicado
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }
};

window.openUserModal = async function(userId = null) {
    const modal = document.getElementById("user-modal");
    const form = document.getElementById("user-form");
    if (!modal || !form) return;

    form.reset();
    editingUserId = userId;
    window.switchUserTab('dados');

    if (userId) {
        document.getElementById("user-modal-title").textContent = "EDITAR USUÁRIO";
        try {
            const userSnap = await getDoc(doc(db, "users", userId));
            if (userSnap.exists()) {
                const data = userSnap.data();
                document.getElementById("user-nome").value = data.Nome || "";
                document.getElementById("user-email").value = data.Email || "";
                
                // CORREÇÃO DO STATUS ATIVO/INATIVO
                // Garante que se estiver vazio ou "ativo", o switch fica ON
                document.getElementById("user-status-active").checked = data.status !== "inativo";

                const roleRadio = form.querySelector(`input[name="user-role"][value="${data.role || 'normal'}"]`);
                if (roleRadio) roleRadio.checked = true;
            }
        } catch (e) { console.error(e); }
    } else {
        document.getElementById("user-modal-title").textContent = "NOVO USUÁRIO";
        document.getElementById("user-status-active").checked = true;
    }
    modal.classList.remove("hidden");
};

window.closeUserModal = () => document.getElementById("user-modal").classList.add("hidden");
window.editUser = (id) => window.openUserModal(id);

// Gerador de Avatar com iniciais
function getAvatar(nome) {
    const initials = nome ? nome.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : "??";
    return `<div class="avatar-circle-medcof">${initials}</div>`;
}

export async function loadUserListData() {
    const tbody = document.getElementById("user-table-body");
    if (!tbody) return;
    
    tbody.innerHTML = "<tr><td colspan='5' style='text-align:center; padding: 30px;'>Carregando...</td></tr>";

    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        tbody.innerHTML = "";

        querySnapshot.forEach((docSnap) => {
            const user = docSnap.data();
            const role = (user.role || "normal").toUpperCase();
            const badgeClass = role === "ADMIN" ? "badge-admin" : "badge-normal";
            
            const row = `
                <tr class="medcof-row">
                    <td style="width: 60px;">${getAvatar(user.Nome)}</td>
                    <td class="user-name-cell">${user.Nome || 'Sem nome'}</td>
                    <td class="user-email-cell">${user.Email}</td>
                    <td><span class="badge-role ${badgeClass}">${role}</span></td>
                    <td class="actions-cell">
                        <button onclick="editUser('${docSnap.id}')" class="btn-table-edit">EDITAR</button>
                        <button onclick="deleteUser('${docSnap.id}')" class="btn-table-delete" title="Excluir Usuário">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </td>
                </tr>
            `;
            tbody.insertAdjacentHTML("beforeend", row);
        });
    } catch (error) {
        console.error("Erro na listagem:", error);
    }
}

// Evento de Salvar
const userForm = document.getElementById("user-form");
if (userForm) {
    userForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const userData = {
            Nome: document.getElementById("user-nome").value,
            Email: document.getElementById("user-email").value.toLowerCase().trim(),
            status: document.getElementById("user-status-active").checked ? "ativo" : "inativo",
            role: document.querySelector('input[name="user-role"]:checked').value,
            updatedAt: serverTimestamp()
        };
        try {
            const finalId = editingUserId || userData.Email;
            await setDoc(doc(db, "users", finalId), userData, { merge: true });
            if (typeof Swal !== 'undefined') Swal.fire("Sucesso", "Perfil atualizado!", "success");
            window.closeUserModal();
            loadUserListData();
        } catch (err) { console.error(err); }
    });
}

// --- FUNÇÃO PARA EXCLUIR USUÁRIO ---
window.deleteUser = async function(userId) {
    // 1. Confirmação de segurança
    const confirmacao = await Swal.fire({
        title: 'Tem certeza?',
        text: "Esta ação não poderá ser revertida!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sim, excluir!',
        cancelButtonText: 'Cancelar'
    });

    if (userId === auth.currentUser.uid || userId === auth.currentUser.email) {
    return Swal.fire('Ação Negada', 'Você não pode excluir sua própria conta de administrador.', 'error');
    }

    if (confirmacao.isConfirmed) {
        try {
            // 2. Deleta o documento no Firestore
            await deleteDoc(doc(db, "users", userId));
            
            Swal.fire(
                'Excluído!',
                'O usuário foi removido do sistema.',
                'success'
            );

            // 3. Atualiza a listagem automaticamente
            loadUserListData();
        } catch (error) {
            console.error("Erro ao excluir usuário:", error);
            Swal.fire('Erro!', 'Não foi possível excluir o usuário.', 'error');
        }
    }
};