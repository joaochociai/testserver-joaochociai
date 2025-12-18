// js/juridico.js
import { db, auth } from "./firebase.js";
import { 
    collection, addDoc, query, onSnapshot, doc, updateDoc, deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { parseDateBR } from "./utils.js";

// --- VARIÁVEIS GLOBAIS ---
window.juridicoAppointments = [];
let juridicoDate = new Date(); 
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
let unsubscribeJuridico = null;

// =========================================================
// 1. INICIALIZAÇÃO DO FORMULÁRIO (ROBUSTO)
// =========================================================
export function initJuridicoForm() {
    const form = document.getElementById("juridico-form");
    if (!form) return;

    // Evita duplicação de eventos
    if (form.getAttribute('data-init') === 'true') return;
    form.setAttribute('data-init', 'true');

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const formData = new FormData(form);
        const data = {};
        formData.forEach((v, k) => data[k] = v.trim());

        // --- TRATAMENTO DE CAMPOS ---

        // 1. Mapeia "Ação" (do select ou input) para "Acao" (sem acento no banco)
        if (data["Ação"]) {
            data.Acao = data["Ação"];
            delete data["Ação"];
        }

        // 2. Data
        const dataAcao = parseDateBR(data.DataAcao);
        if (!dataAcao) {
            return Swal.fire('Erro', 'Data inválida. Use DD/MM/AAAA', 'error');
        }
        data.DataAcao = dataAcao;

        // 3. Valores e Parcelas (Se existirem no HTML)
        if (data.ValorParcela) {
            data.ValorParcela = parseFloat(data.ValorParcela.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0;
        }
        if (data.QtdParcelas) {
            data.QtdParcelas = parseInt(data.QtdParcelas) || 1;
        }

        // 4. Metadados
        data.createdAt = new Date();
        data.createdBy = auth.currentUser?.email || "sistema";
        data.concluido = false; // Status inicial PENDENTE
        data.DataGerarLink = dataAcao; // Compatibilidade com calendário geral

        // --- SALVAR ---
        Swal.fire({ 
            title: 'Salvando...', 
            didOpen: () => Swal.showLoading() 
        });

        try {
            await addDoc(collection(db, "juridico_agendamentos"), data);
            
            await Swal.fire({ 
                icon: 'success', 
                title: 'Agendado!', 
                text: 'Processo jurídico salvo.',
                timer: 1500, 
                showConfirmButton: false 
            });
            
            form.reset();
            // Se estiver na aba calendário, ele atualiza sozinho via listener
        } catch (err) {
            console.error(err);
            Swal.fire('Erro', 'Não foi possível salvar.', 'error');
        }
    });
}

// =========================================================
// 2. FUNÇÃO DE EDITAR (COM ESTILO SWAL LIMPO)
// =========================================================
window.editJuridico = async function(id) {
    // Fecha o modal de detalhes (que está por baixo)
    if(window.closeDetailsModal) window.closeDetailsModal();

    const item = window.juridicoAppointments.find(a => a.id === id);
    if (!item) return;

    // Formata a data para exibir no input
    let dataStr = "";
    if (item.DataAcao?.toDate) dataStr = item.DataAcao.toDate().toLocaleDateString('pt-BR');
    else if (typeof item.DataAcao === 'string') dataStr = item.DataAcao;

    // Abre Modal de Edição
    const { value: formValues } = await Swal.fire({
        title: '✏️ Editar Processo',
        customClass: {
            popup: 'swal-juridico-popup' // Usa o CSS que criamos
        },
        html: `
            <div class="swal-field-container">
                <label class="swal-custom-label">Nome do Aluno</label>
                <input id="swal-nome" class="swal-custom-input" value="${item.Nome || ''}" placeholder="Nome">
            </div>
            
            <div class="swal-field-container">
                <label class="swal-custom-label">E-mail</label>
                <input id="swal-email" class="swal-custom-input" value="${item.Email || ''}" placeholder="email@exemplo.com">
            </div>

            <div class="swal-field-container">
                <label class="swal-custom-label">Ação Necessária</label>
                <input id="swal-acao" class="swal-custom-input" value="${item.Acao || ''}" placeholder="Ex: Renegociação">
            </div>

            <div class="swal-field-container">
                <label class="swal-custom-label">Data (DD/MM/AAAA)</label>
                <input id="swal-data" class="swal-custom-input" value="${dataStr}" placeholder="DD/MM/AAAA">
            </div>

            <div class="swal-field-container">
                <label class="swal-custom-label">Observação</label>
                <textarea id="swal-obs" class="swal-custom-input swal-custom-textarea">${item.Observacao || ''}</textarea>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonColor: '#6A1B9A',
        confirmButtonText: 'Salvar Alterações',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            return {
                Nome: document.getElementById('swal-nome').value,
                Email: document.getElementById('swal-email').value,
                Acao: document.getElementById('swal-acao').value,
                DataString: document.getElementById('swal-data').value,
                Observacao: document.getElementById('swal-obs').value
            }
        }
    });

    if (formValues) {
        const novaData = parseDateBR(formValues.DataString);
        if(!novaData) return Swal.fire('Erro', 'Data inválida.', 'error');

        try {
            Swal.fire({ title: 'Atualizando...', didOpen: () => Swal.showLoading() });
            
            await updateDoc(doc(db, "juridico_agendamentos", id), {
                Nome: formValues.Nome,
                Email: formValues.Email,
                Acao: formValues.Acao,
                DataAcao: novaData,
                Observacao: formValues.Observacao
            });

            if(window.showToast) window.showToast('Agendamento atualizado!');
            else Swal.fire('Sucesso', 'Atualizado com sucesso.', 'success');

        } catch(err) {
            console.error(err);
            Swal.fire('Erro', 'Falha ao atualizar.', 'error');
        }
    }
};

// =========================================================
// 3. FUNÇÕES DO CALENDÁRIO E STATUS
// =========================================================

window.toggleJuridicoStatus = async function(event, id, currentStatus) {
    event.preventDefault();
    const novoStatus = !currentStatus;
    try {
        await updateDoc(doc(db, "juridico_agendamentos", id), { concluido: novoStatus });
        const msg = novoStatus ? "Concluído!" : "Reaberto!";
        if(window.showToast) window.showToast(msg, "success");
    } catch (err) {
        console.error(err);
    }
}

export function loadJuridicoData() {
    const view = document.getElementById("juridico-calendar-view");
    if (view) view.innerHTML = '<div class="loader"></div>';

    if (unsubscribeJuridico) unsubscribeJuridico();

    const q = query(collection(db, "juridico_agendamentos"));
    
    unsubscribeJuridico = onSnapshot(q, (snapshot) => {
        window.juridicoAppointments = [];
        snapshot.forEach(doc => window.juridicoAppointments.push({ id: doc.id, ...doc.data() }));
        renderJuridicoCalendar();
    });
}

export function renderJuridicoCalendar() {
    const container = document.getElementById("juridico-calendar-view");
    if (!container) return;

    const year = juridicoDate.getFullYear();
    const month = juridicoDate.getMonth();
    
    const titleEl = document.getElementById("juridicoMonthDisplay");
    if (titleEl) titleEl.textContent = `${MONTHS[month]} ${year}`;

    const appointmentsMap = {};
    window.juridicoAppointments.forEach((item) => {
        let d;
        if (item.DataAcao?.toDate) d = item.DataAcao.toDate();
        else if (typeof item.DataAcao === "string") d = parseDateBR(item.DataAcao);

        if (d && !isNaN(d) && d.getMonth() === month && d.getFullYear() === year) {
            const key = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
            if (!appointmentsMap[key]) appointmentsMap[key] = [];
            appointmentsMap[key].push(item);
        }
    });

    let html = '<div class="calendar-header-row">';
    ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].forEach(d => html += `<div class="day-label">${d}</div>`);
    html += '</div><div class="calendar-grid">';

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) html += `<div class="calendar-day empty-day"></div>`;

    for (let day = 1; day <= daysInMonth; day++) {
        const key = `${day}/${month + 1}/${year}`;
        const apps = appointmentsMap[key] || [];
        
        const itemsHtml = apps.map(a => {
            const isDone = a.concluido === true;
            const color = isDone ? '#28a745' : '#6A1B9A';
            const decoration = isDone ? 'line-through' : 'none';
            const opacity = isDone ? '0.7' : '1';
            const check = isDone ? '✓ ' : '';

            return `
            <div class="event-dot" 
                 style="background-color: ${color}; text-decoration: ${decoration}; opacity: ${opacity}; cursor: pointer; color: white; padding: 2px 5px; border-radius: 4px; margin-top: 2px; font-size: 11px;"
                 title="Botão Direito: Alternar Status"
                 onclick="window.showDetailsGeneric('${a.id}', 'juridico')"
                 oncontextmenu="window.toggleJuridicoStatus(event, '${a.id}', ${isDone})">
               ${check}${a.Nome ? a.Nome.split(' ')[0] : 'Processo'}
            </div>`;
        }).join("");

        html += `<div class="calendar-day" style="min-height: 80px;">
                    <div class="day-number" style="font-weight:bold; color:#555;">${day}</div>
                    <div class="appointment-container">${itemsHtml}</div>
                 </div>`;
    }
    html += "</div>";
    container.innerHTML = html;
}

window.changeJuridicoMonth = function(delta) {
    juridicoDate.setMonth(juridicoDate.getMonth() + delta);
    renderJuridicoCalendar();
}

window.deleteJuridicoAppointment = async function(id) {
    // 1. Confirmação de Segurança
    const result = await Swal.fire({
        title: 'Excluir Agendamento?',
        text: "Essa ação é irreversível e removerá o item do calendário.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545', // Vermelho Perigo
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Sim, excluir',
        cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    try {
        // 2. Loading
        Swal.fire({ title: 'Excluindo...', didOpen: () => Swal.showLoading() });

        // 3. Deleta do Firestore
        await deleteDoc(doc(db, "juridico_agendamentos", id));

        // 4. Fecha o modal de detalhes (que está aberto por baixo)
        const detailsModal = document.getElementById('details-modal-overlay');
        if(detailsModal) {
            detailsModal.classList.add('modal-hidden');
            detailsModal.style.display = 'none';
        }

        // 5. Sucesso
        Swal.fire('Excluído!', 'O agendamento foi removido.', 'success');

    } catch (err) {
        console.error("Erro ao excluir:", err);
        Swal.fire('Erro', 'Não foi possível excluir o registro.', 'error');
    }
};

window.initJuridicoForm = initJuridicoForm;
window.loadJuridicoData = loadJuridicoData;
window.renderJuridicoCalendar = renderJuridicoCalendar;