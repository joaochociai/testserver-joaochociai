// js/disparos.js
import { db, auth } from './firebase.js';
import { 
    collection, getDocs, query, orderBy, where, doc, deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const DISPAROS_COL = 'controle_registros_disparos';

// VARIÁVEL GLOBAL DO MÓDULO (Resolve o erro de ReferenceError)
let currentViewDate = new Date();
let dadosCarregadosNoMes = {}; // Cache para o modal abrir instantaneamente

// ==============================================================
// 1. CARREGAMENTO DO CALENDÁRIO
// ==============================================================
export async function loadDisparosData() {
    const calendarBody = document.getElementById('calendar-body');
    const monthDisplay = document.getElementById('current-month-display');
    if (!calendarBody || !monthDisplay) return;

    try {
        const year = currentViewDate.getFullYear();
        const month = currentViewDate.getMonth() + 1; // Mês de 1 a 12
        
        monthDisplay.innerText = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(currentViewDate).toUpperCase();

        // 1. Como o formato no BD é DD/MM/AAAA, não podemos usar range queries (>= ou <=) de forma confiável.
        // Vamos buscar todos os registros e filtrar no JavaScript por enquanto.
        const q = query(collection(db, DISPAROS_COL), orderBy("dataRegistro", "desc"));
        const snap = await getDocs(q);
        
        dadosCarregadosNoMes = {}; 
        
        const mesAnoFiltro = `${String(month).padStart(2, '0')}/${year}`; // Ex: "01/2026"

        snap.forEach(docSnap => {
            const d = docSnap.data();
            // Filtra apenas registros que pertencem ao mês/ano visível
            if (d.dataRegistro && d.dataRegistro.includes(mesAnoFiltro)) {
                if (!dadosCarregadosNoMes[d.dataRegistro]) dadosCarregadosNoMes[d.dataRegistro] = [];
                dadosCarregadosNoMes[d.dataRegistro].push({ id: docSnap.id, ...d });
            }
        });

        renderCalendarGrid(year, month - 1);
    } catch (err) { console.error("Erro ao carregar dados:", err); }
}
window.loadDisparosData = loadDisparosData;

// ==============================================================
// 2. RENDERIZAÇÃO DA GRADE
// ==============================================================
function renderCalendarGrid(year, month) {
    const calendarBody = document.getElementById('calendar-body');
    calendarBody.innerHTML = '';

    const diasNoMes = new Date(year, month + 1, 0).getDate();
    const primeiroDiaSemana = new Date(year, month, 1).getDay();

    for (let i = 0; i < primeiroDiaSemana; i++) {
        calendarBody.innerHTML += `<div class="calendar-day empty"></div>`;
    }

    for (let dia = 1; dia <= diasNoMes; dia++) {
        // AJUSTE DE CHAVE: Agora gera "08/01/2026" para bater com o banco
        const dataID = `${String(dia).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`;
        const registros = dadosCarregadosNoMes[dataID] || [];
        
        const totalDisparos = registros.reduce((s, r) => s + (parseInt(r.quantidade) || 0), 0);
        const totalValor = registros.reduce((s, r) => s + (parseFloat(r.valor) || 0), 0);
        const hasData = totalDisparos > 0;

        calendarBody.innerHTML += `
            <div class="calendar-day ${hasData ? 'has-content' : ''}" onclick="window.openDayModal('${dataID}')">
                <div class="day-number">${dia}</div>
                ${hasData ? `
                    <div class="day-info">
                        <span class="badge-disparos"><i class="fas fa-paper-plane"></i> ${totalDisparos}</span>
                        <span class="badge-valor">R$ ${totalValor.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                    </div>
                ` : ''}
            </div>
        `;
    }
}

// ==============================================================
// 3. CONTROLE DO MODAL E NAVEGAÇÃO
// ==============================================================
window.openDayModal = function(dataID) {
    const registros = dadosCarregadosNoMes[dataID] || [];
    const modal = document.getElementById('modal-dia-disparos');
    const tableBody = document.getElementById('modal-table-body');
    const title = document.getElementById('modal-date-title');

    title.innerText = `Registros de ${dataID.split('-').reverse().join('/')}`;
    
    let html = '';
    registros.forEach(r => {
        const valorFmt = r.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        html += `
            <tr>
                <td style="text-align:left;"><strong>${r.tipo}</strong></td>
                <td>${r.responsavel.split(' ')[0]}</td>
                <td>${r.quantidade}</td>
                <td>${valorFmt}</td>
                <td>
                    <button class="icon-btn trash-icon" onclick="window.deleteDisparoModal('${r.id}', '${dataID}')">🗑️</button>
                </td>
            </tr>`;
    });

    tableBody.innerHTML = html || '<tr><td colspan="5">Nenhum registro para este dia.</td></tr>';
    modal.classList.remove('hidden');
};

window.closeDisparoModal = () => document.getElementById('modal-dia-disparos').classList.add('hidden');

window.changeMonth = (dir) => {
    currentViewDate.setMonth(currentViewDate.getMonth() + dir);
    loadDisparosData();
};

window.deleteDisparoModal = async function(id, dataID) {
    if(confirm("Deseja excluir este registro?")) {
        await deleteDoc(doc(db, DISPAROS_COL, id));
        // Recarrega o mês e reabre o modal atualizado
        await loadDisparosData();
        window.openDayModal(dataID);
    }
};