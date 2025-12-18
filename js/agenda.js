// js/agenda.js
import { db } from './firebase.js';
import { collection, addDoc, getDocs, query, orderBy, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { parseDateBR, formatDateUTC, getTodayDateKey, openModal } from './utils.js';

// --- VARIÁVEIS GLOBAIS DO MÓDULO ---
window.allAppointments = [];
window.cobrancaHistoryList = []; // Lista exclusiva cobrança
window.juridicoHistoryList = []; // Lista exclusiva jurídico
let currentCalendarDate = new Date();
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// --- CARREGAR DADOS ---
export async function loadCalendarData() {
    const view = document.getElementById('calendar-view');
    const controls = document.getElementById('calendar-controls');
    
    if (view) view.innerHTML = '<div class="loader"></div>';
    if (controls) controls.style.display = 'none';

    try {
        const q = query(collection(db, 'agendamentos'));
        const snap = await getDocs(q);
        
        window.allAppointments = [];
        snap.forEach(s => window.allAppointments.push({ id: s.id, ...s.data() }));
        
        // Renderiza assim que carrega
        renderCalendar(window.allAppointments);
        
        if (controls) controls.style.display = 'flex';

    } catch (e) { 
        console.error('Erro ao buscar agendamentos', e); 
        if (view) view.innerHTML = '<p>Erro ao carregar dados.</p>'; 
    }
}

// --- RENDERIZAR CALENDÁRIO ---
export function renderCalendar(agendamentos = window.allAppointments) {
    const container = document.getElementById('calendar-view');
    const titleDisplay = document.getElementById('currentMonthDisplay');
    
    if (!container) return;

    const todayKey = getTodayDateKey();
    const renderMonthIndex = currentCalendarDate.getMonth();
    const renderYear = currentCalendarDate.getFullYear();
    const renderMonthName = MONTHS[renderMonthIndex];
    const renderMonthString = String(renderMonthIndex + 1).padStart(2, '0'); // Para comparação de string

    // Atualiza título do mês
    if(titleDisplay) titleDisplay.textContent = `${renderMonthName} ${renderYear}`;
    
    // 1. Mapeia agendamentos por data
    const appointmentsByDate = agendamentos.reduce((acc, item) => {
        let dateObj;
        
        // Tenta converter Timestamp ou String
        if (item.DataGerarLink?.toDate) {
            dateObj = item.DataGerarLink.toDate();
        } else if (typeof item.DataGerarLink === 'string') {
            dateObj = item.DataGerarLink.includes('/') ? parseDateBR(item.DataGerarLink) : new Date(item.DataGerarLink);
        }
        
        // Se a data for válida e pertencer ao mês/ano atual
        if (dateObj && !isNaN(dateObj) && dateObj.getFullYear() === renderYear && dateObj.getMonth() === renderMonthIndex) {
            const key = `${dateObj.getDate()}/${dateObj.getMonth() + 1}/${renderYear}`;
            
            if (!acc[key]) acc[key] = [];
            
            // Pega primeiro nome
            const firstName = item.Nome ? item.Nome.split(' ')[0] : 'Aluno';
            acc[key].push({ name: firstName, id: item.id });
        }
        return acc;
    }, {});
    
    // 2. Alerta de Hoje (Apenas se estiver no mês atual)
    const today = new Date();
    if (today.getMonth() === renderMonthIndex && today.getFullYear() === renderYear) {
        const appointmentsToday = appointmentsByDate[todayKey];
        if (appointmentsToday && appointmentsToday.length > 0) {
            // Mostra alerta apenas se a aba estiver visível
            const tab = document.getElementById('tab-calendario');
            if (tab && !tab.classList.contains('hidden')) {
                const names = appointmentsToday.map(a => a.name).join(', ');
                // Usa a função de alerta do utils ou window
                if(window.showCustomAlert) window.showCustomAlert(names, todayKey);
                else if(window.customAlert) window.customAlert("🚨 Hoje", `Gerar links para: ${names}`);
            }
        }
    }
    
    // 3. Constrói o Grid HTML
    let html = '<div class="calendar-header-row">';
    ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].forEach(d => html += `<div class="day-label">${d}</div>`);
    html += '</div><div class="calendar-grid">';

    const firstDayOfWeek = new Date(renderYear, renderMonthIndex, 1).getDay();
    const daysInMonth = new Date(renderYear, renderMonthIndex + 1, 0).getDate();

    // Dias vazios antes do dia 1
    for(let i=0; i<firstDayOfWeek; i++) html += `<div class="calendar-day empty-day"></div>`;
    
    // Dias do mês
    for(let day=1; day<=daysInMonth; day++) {
        const key = `${day}/${renderMonthIndex + 1}/${renderYear}`;
        const apps = appointmentsByDate[key] || [];
        
        // Gera os links dos nomes
        const namesHtml = apps.map(a => 
            `<span class="app-link" onclick="window.showDetailsGeneric('${a.id}', 'agendamento')">${a.name}</span>`
        ).join('');
        
        const isSched = apps.length > 0 ? 'scheduled-day' : '';
        const isToday = key === todayKey ? 'today-highlight-calendar' : '';
        
        html += `<div class="calendar-day ${isSched} ${isToday}">
                    <div class="day-number">${day}</div>
                    <div class="appointment-names">${namesHtml}</div>
                 </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

// ==============================================================
// MODAL DE DETALHES E CÓPIA (CORREÇÃO DE DADOS)
// ==============================================================

// Função que exibe os detalhes (chamada pelo clique no nome)
window.showDetailsGeneric = function(id, type) {
    // 1. Busca dados
    let data = window.allAppointments?.find(a => a.id === id);
    if (!data && type === 'juridico' && window.juridicoAppointments) {
        data = window.juridicoAppointments.find(a => a.id === id);
    }
    // Fallback: Busca no histórico de cobrança
    if (!data && window.cobrancaList) data = window.cobrancaList.find(a => a.id === id);

    if (!data) return Swal.fire('Ops', 'Agendamento não encontrado.', 'warning');

    window.lastOpenedAppointment = data;

    // Helper de formatação
    const safeDate = (val) => {
        if (!val) return '-';
        if (val.seconds) return new Date(val.seconds * 1000).toLocaleDateString('pt-BR');
        const d = new Date(val);
        return isNaN(d) ? val : d.toLocaleDateString('pt-BR');
    };

    // Formata Valor Monetário
    const rawValor = data.ValorParcela ? parseFloat(data.ValorParcela) : 0;
    const valorFormatted = rawValor > 0 
        ? rawValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) 
        : '-';
    
    // Formata Parcelas
    const parcelas = data.QtdParcelas ? `${data.QtdParcelas}x` : '-';
    const infoFinanceira = (rawValor > 0) ? `<strong>${parcelas} de ${valorFormatted}</strong>` : '-';

    let content = '';
    let headerColor = '#007bff'; 
    let titleText = 'Detalhes do Agendamento';
    let extraButtons = ''; 

    if (type === 'juridico') {
        headerColor = '#6A1B9A';
        titleText = '⚖️ Processo Jurídico';
        
        const dataAcao = safeDate(data.DataAcao);
        
        // Ícone de Status
        let statusHtml = '<span style="color:#f39c12; font-weight:bold;">⏳ PENDENTE</span>';
        if (data.concluido) statusHtml = '<span style="color:#28a745; font-weight:bold;">✅ CONCLUÍDO</span>';

        content = `
            <table class="details-table">
                <tr><th>Nome</th><td>${data.Nome}</td></tr>
                <tr><th>E-mail</th><td>${data.Email || '-'}</td></tr>
                <tr><th>Telefone</th><td>${data.Telefone || '-'}</td></tr>
                
                <tr><td colspan="2" style="border-bottom:none; padding-top:15px; color:#aaa; font-size:11px; text-transform:uppercase; letter-spacing:1px;">Dados do Agendamento</td></tr>
                
                <tr><th>Ação</th><td style="color: #007bff; font-weight: 800;">${data.Acao || data["Ação"] || 'Verificar'}</td></tr>
                <tr><th>Financeiro</th><td>${infoFinanceira}</td></tr>
                <tr><th>Data Ação</th><td>${dataAcao}</td></tr>
                <tr><th>Status</th><td>${statusHtml}</td></tr>
                <tr><th>Observação</th><td style="white-space: pre-wrap; font-style:italic;">${data.Observacao || '-'}</td></tr>
            </table>`;
            
        // Botões Modernos
        extraButtons = `
            <div style="display:flex; gap:10px; margin-top:25px; flex-direction:column;">
                <button onclick="window.editJuridico('${data.id}')" class="btn-modern-action btn-edit-juridico">
                    ✏️ Editar Processo
                </button>
        `;

        // Botão de Excluir (Apenas Admin)
        if (window.currentUserRole === 'admin') {
            extraButtons += `
                <button onclick="window.deleteJuridicoAppointment('${data.id}')" class="btn-modern-action btn-delete-juridico">
                    🗑️ Excluir Agendamento
                </button>
            `;
        }
        
        extraButtons += `</div>`;

    } else {
        // Layout Padrão (Cobrança) - Mantido igual
        content = `
            <table class="details-table">
                <tr><th>Aluno</th><td>${data.Nome}</td></tr>
                <tr><th>Curso</th><td>${data.Curso || '-'}</td></tr>
                <tr><th>Telefone</th><td>${data.Telefone || '-'}</td></tr>
                <tr><th>Motivo</th><td>${data.Motivo || '-'}</td></tr>
                <tr><th>Valor</th><td>${valorFormatted} (${parcelas})</td></tr>
                <tr><th>Vencimento</th><td>${safeDate(data.DataVencimento)}</td></tr>
                <tr><th>Gerar Link</th><td><strong>${safeDate(data.DataGerarLink)}</strong></td></tr>
                <tr><th>Observação</th><td style="white-space: pre-wrap;">${data.Observacao || '-'}</td></tr>
            </table>`;
    }

    // Injeta conteúdo
    document.getElementById('details-modal-content').innerHTML = `
        <div class="details-content-wrapper">
            ${content}
            ${extraButtons}
        </div>`;
    
    // Título e Cor
    const headerTitle = document.getElementById('details-modal-title');
    if (headerTitle) {
        headerTitle.innerHTML = titleText;
        headerTitle.style.color = headerColor;
    }

    // Exibe
    const overlay = document.getElementById('details-modal-overlay');
    overlay.classList.remove('modal-hidden');
    overlay.style.display = 'flex';
};

// Função de Copiar (Formatada)
window.copyAppointmentFormatted = function() {
    const app = window.lastOpenedAppointment;
    if (!app) return;
    
    // Recria a formatação para o texto copiado
    const safeDate = (val) => {
        if (!val) return 'N/A';
        if (val.seconds) return new Date(val.seconds * 1000).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
        const d = new Date(val);
        return isNaN(d) ? val : d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    };
    
    const valor = app.ValorParcela ? parseFloat(app.ValorParcela).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00';

    // Verifica se é jurídico para mudar o formato do texto
    let texto = '';
    if (app.DataAcao) {
        texto = `*Processo Jurídico*\n\n` +
                `Nome: ${app.Nome}\n` +
                `Ação: ${app.Acao}\n` +
                `Data: ${safeDate(app.DataAcao)}\n` +
                `Obs: ${app.Observacao || '-'}`;
    } else {
        texto = `*Dados do Agendamento*\n\n` +
                `Nome: ${app.Nome}\n` +
                `Curso: ${app.Curso || '-'}\n` +
                `Valor: ${valor} (${app.QtdParcelas || 1}x)\n` +
                `Vencimento: ${safeDate(app.DataVencimento)}\n` +
                `Gerar Link: ${safeDate(app.DataGerarLink)}\n` +
                `Obs: ${app.Observacao || '-'}`;
    }
                  
    navigator.clipboard.writeText(texto).then(() => {
        // Feedback visual rápido no botão (opcional)
        const btn = document.getElementById('copy-details-btn');
        const originalText = btn.innerText;
        btn.innerText = "Copiado!";
        setTimeout(() => btn.innerText = originalText, 1500);
    }).catch(err => alert('Erro ao copiar.'));
};

window.renderCalendar = function(agendamentos) {
    const calendarView = document.getElementById('calendar-view');
    const todayKey = getTodayDateKey(); 

    const renderMonthIndex = currentCalendarDate.getMonth();
    const renderYear = currentCalendarDate.getFullYear();
    const renderMonthName = MONTHS[renderMonthIndex];
    
    const titleDisplay = document.getElementById('currentMonthDisplay');
    if(titleDisplay) titleDisplay.textContent = `${renderMonthName} ${renderYear}`;
    
    // 1. Mapeamento de dados (CORRIGIDO PARA LER TIMESTAMP E TEXTO)
    const appointmentsByDate = agendamentos.reduce((acc, item) => {
        let dateObject;

        // CENÁRIO 1: É um Timestamp do Firebase (Novos Agendamentos)
        if (item.DataGerarLink && typeof item.DataGerarLink.toDate === 'function') {
            dateObject = item.DataGerarLink.toDate();
        } 
        // CENÁRIO 2: É texto ou Date string (Importados)
        else if (item.DataGerarLink) {
            const dateString = String(item.DataGerarLink);
            if (dateString.includes('/')) {
                const parts = dateString.split('/');
                dateObject = new Date(parts[2], parts[1] - 1, parts[0]);
            } else {
                dateObject = new Date(dateString);
            }
        }

        // Se a data for válida, processa
        if (dateObject && !isNaN(dateObject)) {
            // Ajuste de fuso horário para exibição correta no dia
            const dateKey = formatDate(dateObject); 
            const fullName = item.Nome || 'Aluno';
            const firstName = fullName.split(' ')[0];

            // Verifica Ano e Mês (usando métodos locais para casar com a visualização)
            if (dateObject.getFullYear() === renderYear && dateObject.getMonth() === renderMonthIndex) {
                if (!acc[dateKey]) acc[dateKey] = [];
                acc[dateKey].push({ name: firstName, id: item.id }); 
            }
        }
        return acc;
    }, {});
    
    const dayLabels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    let gridHtml = '<div class="calendar-header-row">';
    dayLabels.forEach(label => gridHtml += `<div class="day-label">${label}</div>`);
    gridHtml += '</div><div class="calendar-grid">';

    for (let i = 0; i < firstDayOfMonth; i++) gridHtml += `<div class="calendar-day empty-day"></div>`;

    for (let day = 1; day <= daysInMonth; day++) { 
        const dayString = String(day).padStart(2, '0');
        const monthString = String(renderMonthIndex + 1).padStart(2, '0');
        const dateKey = `${dayString}/${monthString}/${renderYear}`; 
        
        const namesArray = appointmentsByDate[dateKey];
        const namesHtml = namesArray ? namesArray.map(app => 
            `<span class="app-link" onclick="window.showAppointmentDetails('${app.id}')" title="Ver detalhes de ${app.name}">${app.name}</span>`
        ).join('') : '';
        
        const isScheduled = namesArray && namesArray.length > 0 ? 'scheduled-day' : '';
        const isTodayHighlight = (dateKey === todayKey) ? 'today-highlight-calendar' : '';

        gridHtml += `<div class="calendar-day ${isScheduled} ${isTodayHighlight}">
                    <div class="day-number">${day}</div>
                    <div class="appointment-names">${namesHtml}</div>
                 </div>`;
    }
    gridHtml += '</div>';
    calendarView.innerHTML = gridHtml;
}

// --- NAVEGAÇÃO DE MÊS ---
export function changeMonth(delta) {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + delta);
    renderCalendar(window.allAppointments);
}

// --- ENVIO DO FORMULÁRIO ---
// --- ENVIO DO FORMULÁRIO (COM SWEETALERT2) ---
export async function submitAgendamento(formEl) {
    const formData = new FormData(formEl);
    const obj = {};
    
    formData.forEach((v,k)=>obj[k]=v.trim());
    
    // Conversões
    if (obj.ValorParcela) obj.ValorParcela = parseFloat(obj.ValorParcela.replace('R$','').replace(/\./g,'').replace(',','.')); 
    if (obj.QtdParcelas) obj.QtdParcelas = parseInt(obj.QtdParcelas);
    
    const dVenc = parseDateBR(obj.DataVencimento);
    const dGerar = parseDateBR(obj.DataGerarLink);
    
    // Validação com SweetAlert
    if(!dVenc || !dGerar) {
        return Swal.fire('Datas Inválidas', 'Verifique os campos de data.', 'warning');
    }
    
    obj.DataVencimento = dVenc;
    obj.DataGerarLink = dGerar;
    obj.createdAt = new Date(); 
    obj.createdBy = window.currentUserRole || 'Sistema'; 

    // Loading...
    Swal.fire({
        title: 'Agendando...',
        didOpen: () => Swal.showLoading()
    });

    try { 
        await addDoc(collection(db,'agendamentos'), obj); 
        
        // Sucesso!
        await Swal.fire({
            title: 'Sucesso!',
            text: 'Link agendado corretamente.',
            icon: 'success',
            timer: 1500,
            showConfirmButton: false
        });

        formEl.reset(); 
        loadCalendarData(); 
        
        // Opcional: Limpar msg antiga se existir
        const oldMsg = document.getElementById('form-message');
        if(oldMsg) oldMsg.textContent = '';

    } catch(e){ 
        console.error(e); 
        Swal.fire('Erro', 'Falha ao salvar no banco de dados.', 'error');
    }
}

// --- VINCULAR EVENTOS ---
const agendamentoForm = document.getElementById('link-schedule-form');
if (agendamentoForm) {
    agendamentoForm.addEventListener('submit', (e)=>{ e.preventDefault(); submitAgendamento(agendamentoForm); });
}

// ==========================================
//  HISTÓRICO DE AGENDAMENTOS - COMPLETO
// ==========================================

// Carrega histórico
window.loadHistoryData = async function () {
    const tbody = document.getElementById("table-body");
    // Mostra loader apenas se a tabela estiver vazia
    if (tbody && tbody.children.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center"><div class="loader"></div></td></tr>';
    }

    try {
        const promises = [];
        const isAdmin = window.currentUserRole === 'admin';
        const sectors = window.currentUserSectors || [];

        // 1. Busca COBRANÇA (Se for Admin ou tiver setor Cobrança)
        if (isAdmin || sectors.includes('cobranca')) {
            // Removemos orderBy do servidor para evitar erro de índice
            const qCob = query(collection(db, 'agendamentos')); 
            promises.push(getDocs(qCob).then(snap => 
                snap.docs.map(d => ({ id: d.id, ...d.data(), type: 'cobranca' }))
            ));
        }

        // 2. Busca JURÍDICO (Se for Admin ou tiver setor Jurídico)
        if (isAdmin || sectors.includes('juridico')) {
            const qJur = query(collection(db, 'juridico_agendamentos'));
            promises.push(getDocs(qJur).then(snap => 
                snap.docs.map(d => ({ id: d.id, ...d.data(), type: 'juridico' }))
            ));
        }

        // Aguarda todas as buscas
        const results = await Promise.all(promises);
        
        // Junta tudo em uma única lista
        let combined = results.flat();

        // Ordena no cliente (Mais seguro e rápido para essa qtde de dados)
        combined.sort((a, b) => {
            const dateA = getDateObj(a);
            const dateB = getDateObj(b);
            return dateB - dateA; // Decrescente (Mais novo primeiro)
        });

        window.allAppointments = combined;
        
        // Chama o filtro para exibir apenas o contexto atual (Jurídico ou Cobrança)
        window.filterList();

    } catch (err) {
        console.error("Erro ao carregar histórico unificado:", err);
        if(tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red">Erro ao carregar dados.</td></tr>';
    }
};

// Helper para pegar a data correta para ordenação
function getDateObj(item) {
    const val = item.type === 'juridico' ? item.DataAcao : item.DataGerarLink;
    if (!val) return new Date(0);
    if (val.toDate) return val.toDate();
    if (typeof val === 'string') return parseDateBR(val) || new Date(val);
    return new Date(val);
}

// Renderiza tabela
window.renderHistoryTable = function(list) {
    const tbody = document.getElementById("table-body");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!list || list.length === 0) {
        document.getElementById("no-results-message").style.display = "block";
        return;
    }
    document.getElementById("no-results-message").style.display = "none";

    list.forEach(item => {
        const tr = document.createElement("tr");
        
        // Define a classe da linha para o CSS pintar (row-type-juridico ou row-type-cobranca)
        tr.className = item.type === 'juridico' ? 'row-type-juridico' : 'row-type-cobranca';

        let dataPrincipal, acaoOuMotivo, valorDisplay, dataVenc;

        if (item.type === 'juridico') {
            // --- LAYOUT JURÍDICO ---
            dataPrincipal = formatDateUTC(item.DataAcao);
            
            // Adiciona a etiqueta visual
            acaoOuMotivo = `<span class="juridico-tag">JURÍDICO</span> ${item.Acao || 'Ação não informada'}`;
            
            valorDisplay = '-'; // Jurídico geralmente não tem valor de parcela aqui
            dataVenc = '-';
        } else {
            // --- LAYOUT COBRANÇA ---
            dataPrincipal = formatDateUTC(item.DataGerarLink);
            acaoOuMotivo = item.Motivo || item.Curso || '-';
            
            valorDisplay = item.ValorParcela 
                ? parseFloat(item.ValorParcela).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})
                : 'R$ 0,00';
            
            dataVenc = item.DataVencimento ? formatDateUTC(item.DataVencimento) : '-';
        }

        tr.innerHTML = `
            <td><strong>${dataPrincipal}</strong></td>
            <td>${item.Nome || "Sem nome"}</td>
            <td>${acaoOuMotivo}</td>
            <td>${valorDisplay}</td>
            <td>${dataVenc}</td>
            <td style="text-align:center;">
                <button class="table-btn" onclick="window.showDetailsGeneric('${item.id}', '${item.type}')">Ver Detalhes</button>
            </td>
        `;

        tbody.appendChild(tr);
    });
};

// Abrir modal de detalhes
window.openDetails = function (docId) {
    const item = window.allAppointments.find(a => a.id === docId);
    if (!item) return;

    document.getElementById("details-modal-title").innerText = item.Nome;
    
    // Conteúdo atualizado com o campo E-mail
    document.getElementById("details-modal-content").innerHTML = `
        <p><strong>E-mail:</strong> ${item.Email || "-"}</p>
        <p><strong>Curso:</strong> ${item.Curso || "-"}</p>
        <p><strong>Telefone:</strong> ${item.Telefone || "-"}</p>
        <p><strong>Motivo:</strong> ${item.Motivo || "-"}</p>
        <p><strong>Gerar link:</strong> ${formatDateUTC(item.DataGerarLink)}</p>
        <p><strong>Vencimento:</strong> ${formatDateUTC(item.DataVencimento)}</p>
        <p><strong>Parcelas:</strong> ${item.QtdParcelas || "1"}</p>
        <p><strong>Valor Parcela:</strong> R$ ${item.ValorParcela || "0,00"}</p>
        <p><strong>Observação:</strong> ${item.Observacao || "-"}</p>
    `;

    document.getElementById("details-modal-overlay").classList.remove("modal-hidden");
    document.getElementById("details-modal-overlay").style.display = 'flex';
};

// Fechar modal
window.closeDetailsModal = function () {
    document.getElementById("details-modal-overlay").classList.add("modal-hidden");
};

// ==========================
// FILTRO DE BUSCA
// ==========================
window.filterList = function () {
    const search = document.getElementById("list-search").value.toLowerCase();
    const start = document.getElementById("filter-start-date").value;
    const end = document.getElementById("filter-end-date").value;

    let filtered = [...window.allAppointments];

    // 1. FILTRO DE CONTEXTO (Cobrança vs Jurídico)
    // Se estivermos na aba Jurídico, mostra SÓ jurídico.
    // Se Cobrança, SÓ cobrança.
    if (window.currentHistoryContext === 'juridico') {
        filtered = filtered.filter(item => item.type === 'juridico');
    } else if (window.currentHistoryContext === 'cobranca') {
        filtered = filtered.filter(item => item.type === 'cobranca');
    }
    // Se for admin e não tiver contexto (acesso direto?), mostra tudo.

    // 2. Filtro texto
    if (search) {
        filtered = filtered.filter(item =>
            (item.Nome || "").toLowerCase().includes(search) ||
            (item.Email || "").toLowerCase().includes(search) ||
            (item.Curso || "").toLowerCase().includes(search) ||
            (item.Acao || "").toLowerCase().includes(search) // Busca também na ação do jurídico
        );
    }

    // 3. Filtro data inicial
    if (start) {
        const s = parseDateBR(start);
        filtered = filtered.filter(i => {
            const dateVal = i.type === 'juridico' ? i.DataAcao : i.DataGerarLink;
            return parseDateBR(formatDateUTC(dateVal)) >= s;
        });
    }

    // 4. Filtro data final
    if (end) {
        const e = parseDateBR(end);
        filtered = filtered.filter(i => {
            const dateVal = i.type === 'juridico' ? i.DataAcao : i.DataGerarLink;
            return parseDateBR(formatDateUTC(dateVal)) <= e;
        });
    }

    window.renderHistoryTable(filtered);
};

// ==========================
// LIMPAR FILTROS
// ==========================
window.clearFilters = function () {
    document.getElementById("list-search").value = "";
    document.getElementById("filter-start-date").value = "";
    document.getElementById("filter-end-date").value = "";

    window.renderHistoryTable(window.allAppointments);
};

// ==========================
// ORDENAR TABELA
// ==========================
window.sortTable = function (field) {
    let arr = [...window.allAppointments];

    const icon = document.getElementById(`icon-${field}`);

    // Detecta direção
    let asc = icon.innerText !== "▲";

    arr.sort((a, b) => {
        let x = a[field] || "";
        let y = b[field] || "";

        if (typeof x === "string") x = x.toLowerCase();
        if (typeof y === "string") y = y.toLowerCase();

        return asc ? (x > y ? 1 : -1) : (x < y ? 1 : -1);
    });

    icon.innerText = asc ? "▲" : "▼";

    window.renderHistoryTable(arr);
};

// ==========================================
//  HISTÓRICO COBRANÇA
// ==========================================
window.loadCobrancaHistory = async function() {
    const tbody = document.getElementById("table-body-cobranca");
    if(tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center"><div class="loader"></div></td></tr>';

    try {
        const q = query(collection(db, 'agendamentos')); // Pega tudo e ordena no cliente
        const snap = await getDocs(q);
        
        window.cobrancaHistoryList = snap.docs.map(d => ({ id: d.id, ...d.data(), type: 'cobranca' }));
        
        // Ordena por data gerar link desc
        window.cobrancaHistoryList.sort((a,b) => {
            const dA = a.DataGerarLink?.toDate ? a.DataGerarLink.toDate() : new Date(a.DataGerarLink);
            const dB = b.DataGerarLink?.toDate ? b.DataGerarLink.toDate() : new Date(b.DataGerarLink);
            return dB - dA;
        });

        window.filterCobrancaHistory(); // Renderiza
    } catch(e) { console.error(e); if(tbody) tbody.innerHTML = 'Erro.'; }
};

window.filterCobrancaHistory = function() {
    const search = document.getElementById("search-cobranca").value.toLowerCase();
    const start = parseDateBR(document.getElementById("filter-start-cobranca").value);
    const end = parseDateBR(document.getElementById("filter-end-cobranca").value);

    let filtered = window.cobrancaHistoryList.filter(item => {
        // Filtro Texto
        const matchText = (item.Nome || "").toLowerCase().includes(search) || 
                          (item.Curso || "").toLowerCase().includes(search);
        
        // Filtro Data
        let matchDate = true;
        const d = item.DataGerarLink?.toDate ? item.DataGerarLink.toDate() : new Date(item.DataGerarLink);
        // Zera horas para comparação justa
        d.setHours(0,0,0,0);
        
        if (start && d < start) matchDate = false;
        if (end && d > end) matchDate = false;

        return matchText && matchDate;
    });

    renderCobrancaTable(filtered);
};

window.clearCobrancaFilters = function() {
    document.getElementById("search-cobranca").value = "";
    document.getElementById("filter-start-cobranca").value = "";
    document.getElementById("filter-end-cobranca").value = "";
    renderCobrancaTable(window.cobrancaHistoryList);
};

function renderCobrancaTable(list) {
    const tbody = document.getElementById("table-body-cobranca");
    const noRes = document.getElementById("no-results-cobranca");
    if(!tbody) return;
    tbody.innerHTML = "";

    if(!list.length) { noRes.style.display = 'block'; return; }
    noRes.style.display = 'none';

    list.forEach(item => {
        const tr = document.createElement("tr");
        tr.className = "row-type-cobranca"; // Classe visual azul
        
        const valor = item.ValorParcela ? parseFloat(item.ValorParcela).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : '-';
        
        tr.innerHTML = `
            <td><strong>${formatDateUTC(item.DataGerarLink)}</strong></td>
            <td>${item.Nome || '-'}</td>
            <td>${item.Curso || item.Motivo || '-'}</td>
            <td>${valor}</td>
            <td>${formatDateUTC(item.DataVencimento)}</td>
            <td style="text-align:center;">
                <button class="table-btn" onclick="window.showDetailsGeneric('${item.id}', 'agendamento')">Ver Detalhes</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.sortCobranca = function(field) {
    // Lógica simples de ordenação toggle
    // (Pode implementar igual ao sortTable antigo se desejar)
    window.cobrancaHistoryList.reverse();
    renderCobrancaTable(window.cobrancaHistoryList);
};


// ==========================================
//  HISTÓRICO JURÍDICO
// ==========================================
window.loadJuridicoHistory = async function() {
    const tbody = document.getElementById("table-body-juridico");
    if(tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center"><div class="loader"></div></td></tr>';

    try {
        const q = query(collection(db, 'juridico_agendamentos'));
        const snap = await getDocs(q);
        
        window.juridicoHistoryList = snap.docs.map(d => ({ id: d.id, ...d.data(), type: 'juridico' }));
        
        window.juridicoHistoryList.sort((a,b) => {
            const dA = a.DataAcao?.toDate ? a.DataAcao.toDate() : new Date(a.DataAcao);
            const dB = b.DataAcao?.toDate ? b.DataAcao.toDate() : new Date(b.DataAcao);
            return dB - dA;
        });

        window.filterJuridicoHistory();
    } catch(e) { console.error(e); if(tbody) tbody.innerHTML = 'Erro.'; }
};

window.filterJuridicoHistory = function() {
    const search = document.getElementById("search-juridico").value.toLowerCase();
    const start = parseDateBR(document.getElementById("filter-start-juridico").value);
    const end = parseDateBR(document.getElementById("filter-end-juridico").value);

    let filtered = window.juridicoHistoryList.filter(item => {
        const matchText = (item.Nome || "").toLowerCase().includes(search) || 
                          (item.Acao || "").toLowerCase().includes(search);
        
        let matchDate = true;
        const d = item.DataAcao?.toDate ? item.DataAcao.toDate() : new Date(item.DataAcao);
        d.setHours(0,0,0,0);
        
        if (start && d < start) matchDate = false;
        if (end && d > end) matchDate = false;

        return matchText && matchDate;
    });

    renderJuridicoTable(filtered);
};

window.clearJuridicoFilters = function() {
    document.getElementById("search-juridico").value = "";
    document.getElementById("filter-start-juridico").value = "";
    document.getElementById("filter-end-juridico").value = "";
    renderJuridicoTable(window.juridicoHistoryList);
};

function renderJuridicoTable(list) {
    const tbody = document.getElementById("table-body-juridico");
    const noRes = document.getElementById("no-results-juridico");
    if(!tbody) return;
    tbody.innerHTML = "";

    if(!list.length) { noRes.style.display = 'block'; return; }
    noRes.style.display = 'none';

    list.forEach(item => {
        const tr = document.createElement("tr");
        tr.className = "row-type-juridico"; // Classe visual roxa
        
        tr.innerHTML = `
            <td><strong>${formatDateUTC(item.DataAcao)}</strong></td>
            <td>${item.Nome || '-'}</td>
            <td>${item.Email || '-'}</td>
            <td>${item.Acao || '-'}</td>
            <td><small>${formatDateUTC(item.createdAt)}</small></td>
            <td style="text-align:center;">
                <button class="table-btn" onclick="window.showDetailsGeneric('${item.id}', 'juridico')">Ver Detalhes</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- EXPOR AO WINDOW PARA O HTML FUNCIONAR ---
window.loadCalendarData = loadCalendarData;
window.renderCalendar = renderCalendar;
window.changeMonth = changeMonth;
window.submitAgendamento = submitAgendamento;