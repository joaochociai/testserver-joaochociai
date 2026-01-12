// js/escala.js
import { db, auth } from './firebase.js';
import { 
    doc, updateDoc, getDoc, setDoc, deleteDoc, getDocs, collection, query, where, writeBatch, serverTimestamp, orderBy 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getCycleStage, ESCALA_CYCLE, NAME_MAPPING, normalizeText } from "./utils.js";

const ESCALA_INDIVIDUAL_COLLECTION = "escala_individual"; // Nova coleção

// Estado local
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1; // 1-12
let employeeList = []; 
let cachedEvents = [];
let cachedHolidays = {};

// ------------------------------------------------------------------
// 1. CONFIGURAÇÕES E MAPEAMENTOS
// ------------------------------------------------------------------

// Define quem é de qual turno para a automação
const EMPLOYEE_PROFILES = {
    // TURNO MANHÃ
    'Lorrannye': 'MANHA', 'Júlia': 'MANHA', 'Gilrêania': 'MANHA', 
    'Fabiana': 'MANHA', 'Fernanda': 'MANHA',
    // TURNO TARDE
    'Mônica': 'TARDE', 'Natália': 'TARDE', 'Rozana': 'TARDE', 
    'Janny': 'TARDE', 'Dayse': 'TARDE',
    // FIXOS
    'Carmem': 'FIXO_SUPERVISOR2', 'Vanessa': 'FIXO_SUPERVISOR1', 
    'João': 'FIXO_ANALISTA', 'Elaine': 'FIXO_GERENCIA'
};

const RODA_FERIADO_MANHA = ['Lorrannye', 'Júlia', 'Gilrêania', 'Fabiana', 'Fernanda'];
const RODA_FERIADO_TARDE = ['Mônica', 'Dayse', 'Natália', 'Rozana', 'Janny'];
const RODA_SUPERVISOR = ['Vanessa', 'Carmem'];

const SHIFT_RULES = {
    'MANHA': { '6h': 'atend_08_14', '8h': 'atend_08_16' },
    'TARDE': { '6h': 'atend_14_20', '8h': 'atend_12_20' }
};

// Definição das linhas da tabela (Visualização)
const WEEKDAY_ROWS = [
    { key: 'ferias', label: 'Férias', time: '', cssClass: 'row-ferias' },
    { key: 'folga', label: 'Folga', time: '', cssClass: 'row-folga' },
    { type: 'header', label: 'MANHÃ - TURNO 1', cssClass: 'header-manha' },
    { key: 'gerencia', label: 'Gerência', time: '9h às 18h', cssClass: 'row-manha' },
    { key: 'analista', label: 'Analista Cobrança', time: '08h às 17h', cssClass: 'row-manha' },
    { key: 'supervisor1', label: 'Supervisora 1', time: '08h às 17h', cssClass: 'row-manha' },
    { key: 'atend_08_14', label: 'Atendente Financeiro', time: '08h às 14h', cssClass: 'row-manha' },
    { key: 'atend_08_16', label: 'Atendente Financeiro', time: '08h às 16h', cssClass: 'row-manha' },
    { type: 'header', label: 'TARDE - TURNO 2', cssClass: 'header-tarde' },
    { key: 'supervisor2', label: 'Supervisora 2', time: '11h às 20h', cssClass: 'row-tarde' },
    { key: 'atend_14_20', label: 'Atendente Financeiro', time: '14h às 20h', cssClass: 'row-tarde' },
    { key: 'atend_12_20', label: 'Atendente Financeiro', time: '12h às 20h', cssClass: 'row-tarde' },
];

const WEEKEND_ROWS = [
    { key: 'fds_folga', label: 'FOLGA FDS', cssClass: 'row-folga' },
    { key: 'fds_8_14', label: '8h às 14h' },
    { key: 'fds_10_16', label: '10h às 16h' },
    { key: 'fds_12_18', label: '12h às 18h' }
];

function renderNameWithRef(item, myNorm, normalize, highlightStyle = '', cargoKey = '') {
    if (!item.ref) return item.nome;

    const isMe = myNorm && normalize(item.nome) === myNorm;
    
    // Identifica se a linha atual é de folga ou férias
    const isLeave = ['folga', 'fds_folga', 'ferias'].includes(cargoKey);

    // SÓ mostra o relógio se NÃO for folga (ou seja, é horário de trabalho especial)
    const symbol = !isLeave ? ' <i class="fas fa-clock-rotate-left" style="font-size:10px; color:#e67e22; margin-left:3px;"></i>' : '';

    // Cores: Vermelho para folgas, Laranja para horários alterados
    const color = isLeave ? '#c0392b' : '#e67e22';

    const style = `
        cursor: help;
        border-bottom: 2px dotted ${color};
        color: ${color};
        font-weight: 600;
        ${isMe ? highlightStyle : ''}
    `;

    const tooltipText = isLeave ? `Folga ref. ao feriado de ${item.ref}` : item.ref;

    return `
    <span class="tooltip-wrapper" data-tooltip="${tooltipText}">
        <span style="${style}">
            ${item.nome}${symbol}
        </span>
    </span>
    `;
}

// ------------------------------------------------------------------
// 2. INICIALIZAÇÃO E CARREGAMENTO
// ------------------------------------------------------------------

export async function initEscala() {
    renderMonthLabel();
    await loadHolidaysGlobal(); // 1. Carrega todos os feriados
    loadEmployeeList();         
    loadEscala();               
    
    // 2. Inicia o cálculo de folgas pendentes (fundo)
    calculateYearlyCompOffs(); 

    const prev = document.getElementById('prev-month');
    if(prev) prev.onclick = () => changeEscalaMonth(-1);
    const next = document.getElementById('next-month');
    if(next) next.onclick = () => changeEscalaMonth(1);
}

function renderMonthLabel() {
    const date = new Date(currentYear, currentMonth - 1, 1);
    const name = date.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    
    // Alvo: O span dentro do seu novo Navigation Card
    const label = document.getElementById('escala-month-label');
    if (label) {
        label.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    }
}

// CARREGAMENTO: Busca registros individuais e monta o GRID em memória
async function loadEscala() {
    const container = document.getElementById('escala-container');
    // Não limpa o container aqui se ele já tiver a estrutura, apenas mostra loader se necessário
    // Mas para garantir, vamos manter o fluxo padrão:
    
    try {
        const year = currentYear;
        const monthIndex = currentMonth - 1;

        // 1. Define intervalo de datas para buscar no banco
        const firstDay = new Date(year, monthIndex, 1);
        const startOffset = firstDay.getDay() === 0 ? -6 : 1 - firstDay.getDay();
        const startDate = new Date(year, monthIndex, 1 + startOffset);
        
        const lastDay = new Date(year, monthIndex + 1, 0);
        const endOffset = lastDay.getDay() === 0 ? 0 : 7 - lastDay.getDay();
        const endDate = new Date(year, monthIndex + 1, 0 + endOffset);

        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        console.log(`Buscando dados no banco de: ${startStr} até ${endStr}`);

        // 2. Busca no Firebase
        const q = query(
            collection(db, "escala_individual"), 
            where("data", ">=", startStr),
            where("data", "<=", endStr)
        );

        const snapshot = await getDocs(q);
        cachedEvents = [];
        snapshot.forEach(doc => {
            cachedEvents.push(doc.data());
        });

        console.log(`Registros encontrados no banco: ${cachedEvents.length}`);

        // 3. Reconstrói a tabela (O Grid Vazio)
        renderAllWeeks('escala-container');
        
        // 4. Preenche os nomes (A Pintura)
        populateGridFromEvents();

        checkHolidayCompOffs();
        
    } catch (err) {
        console.error("Erro loading:", err);
    }
}

async function loadHolidaysGlobal() {
    try {
        const q = query(collection(db, "feriados_config"));
        const snapshot = await getDocs(q);
        cachedHolidays = {};
        snapshot.forEach(doc => cachedHolidays[doc.id] = doc.data());
        window.feriadosCache = cachedHolidays; // Disponibiliza para a tabela pintar de laranja
    } catch (e) { console.error("Erro feriados:", e); }
}

// 2. Calcula Folgas Pendentes (Busca Inteligente no Banco)

async function calculateYearlyCompOffs() {
    const auditData = {}; 
    const today = new Date().toISOString().split('T')[0];
    
    try {
        // A. Pega datas de feriados passados
        const holidayDates = Object.keys(cachedHolidays).filter(date => date <= today);
        
        if (holidayDates.length > 0) {
            const chunkSize = 10;
            for (let i = 0; i < holidayDates.length; i += chunkSize) {
                const chunk = holidayDates.slice(i, i + chunkSize);
                
                const qWork = query(collection(db, "escala_individual"), where("data", "in", chunk));
                const snapWork = await getDocs(qWork);
                
                snapWork.forEach(doc => {
                    const d = doc.data();
                    
                    // --- NOVA REGRA: IGNORAR SUPERVISORAS EM FINAL DE SEMANA ---
                    // Converte string '2024-05-01' para objeto Data para saber o dia da semana
                    // Adiciona 'T12:00' para evitar problemas de fuso horário (-3h)
                    const dateObj = new Date(d.data + 'T12:00:00'); 
                    const dayOfWeek = dateObj.getDay(); // 0=Dom, 6=Sab
                    
                    // Pega o perfil do funcionário (Ex: 'FIXO_SUPERVISOR1')
                    // Usa o mapeamento reverso se o nome for curto
                    const fullName = Object.entries(NAME_MAPPING).find(([k,v]) => k === d.nome)?.[1] || d.nome;
                    const profile = EMPLOYEE_PROFILES[d.nome] || EMPLOYEE_PROFILES[fullName];

                    // Se for Fim de Semana E o cargo for FIXO -> NÃO CONTA COMO PENDÊNCIA
                    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
                    const isFixedRole = profile && profile.startsWith('FIXO_');

                    if (isWeekend && isFixedRole) {
                        return; // Pula este registro, não gera crédito de folga
                    }
                    // -----------------------------------------------------------

                    // Se TRABALHOU (não é folga/ferias/fds_folga)
                    if (d.cargoKey !== 'folga' && d.cargoKey !== 'ferias' && d.cargoKey !== 'fds_folga') {
                        if (!auditData[d.nome]) auditData[d.nome] = { worked: [], taken: 0 };
                        
                        auditData[d.nome].worked.push({
                            date: d.data,
                            reason: cachedHolidays[d.data]?.nome || 'Feriado'
                        });
                    }
                });
            }
        }

        // B. Busca folgas tiradas no ano
        const startYear = `${new Date().getFullYear()}-01-01`;
        const qFolgas = query(
            collection(db, "escala_individual"), 
            where("data", ">=", startYear), 
            // Procura ambos os tipos de folga no banco
            where("cargoKey", "in", ["folga", "fds_folga"]) 
        );
        const snapFolgas = await getDocs(qFolgas);

        snapFolgas.forEach(doc => {
            const d = doc.data();
            
            // REGRA DE OURO: 
            // Se for folga de fim de semana (fds_folga), SÓ conta se tiver uma 'referencia'.
            // As folgas de ciclo (automáticas) não possuem este campo e serão ignoradas.
            const isValida = (d.cargoKey === 'folga') || (d.cargoKey === 'fds_folga' && d.referencia);

            if (isValida && auditData[d.nome]) {
                auditData[d.nome].taken++; 
            }
        });

        // C. Atualiza Visual
        updateSidebarBadges(auditData);

    } catch (e) {
        console.error("Erro calculando folgas:", e);
    }
}

// Atualiza visualmente a sidebar
function updateSidebarBadges(auditData) {
    document.querySelectorAll('.employee-card').forEach(card => {
        const nameEl = card.querySelector('.card-name');
        if (!nameEl) return;
        
        const fullName = nameEl.innerText;
        const shortName = fullName.split(' ')[0];
        
        // Tenta achar dados pelo nome
        const userData = auditData[shortName] || auditData[fullName] || { worked: [], taken: 0 };
        
        // Cálculo: Trabalhados - Tirados
        const pendingCount = userData.worked.length - userData.taken;
        
        let badge = card.querySelector('.comp-off-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'comp-off-badge';
            const editBtn = card.querySelector('.edit-btn');
            if(editBtn) card.insertBefore(badge, editBtn);
            else card.appendChild(badge);
        }
        
        if (pendingCount > 0) {
            badge.innerText = `${pendingCount} Pend.`;
            badge.classList.add('visible');
            badge.style.cursor = 'pointer';
            badge.title = "Clique para ver detalhes";
            
            // --- O PULO DO GATO: CLIQUE PARA VER DETALHES ---
            badge.onclick = (e) => {
                e.stopPropagation(); // Evita arrastar o card
                showCompOffDetails(shortName, userData);
            };
            // ------------------------------------------------
        } else {
            badge.classList.remove('visible');
            badge.onclick = null;
        }
    });
}

function showCompOffDetails(name, data) {
    const workedList = data.worked.map(item => {
        const [y, m, d] = item.date.split('-');
        return `<li><b>${d}/${m}</b> - ${item.reason}</li>`;
    }).join('');

    const htmlContent = `
        <div style="text-align: left; font-size: 14px;">
            <p><strong>Feriados Trabalhados (${data.worked.length}):</strong></p>
            <ul style="margin-bottom: 15px; padding-left: 20px; color: #c0392b;">
                ${workedList || '<li>Nenhum encontrado</li>'}
            </ul>
            <p><strong>Folgas Tiradas no Ano:</strong> ${data.taken}</p>
            <hr>
            <p style="font-size: 16px;"><strong>Saldo Pendente: <span style="color:red">${data.worked.length - data.taken}</span></strong></p>
        </div>
    `;

    Swal.fire({
        title: `Extrato de Folgas: ${name}`,
        html: htmlContent,
        confirmButtonText: 'Entendi'
    });
}

// ------------------------------------------------------------------
// 3. RENDERIZAÇÃO (Grid Visual)
// ------------------------------------------------------------------

function populateGridFromEvents() {
    // 1. Limpa tudo visualmente
    document.querySelectorAll('.escala-input').forEach(el => el.value = '');

    if (cachedEvents.length === 0) return;

    // 2. Agrupa os dados em memória
    const cellMap = {};

    cachedEvents.forEach(record => {
        let shouldRender = true;

        // --- FILTRO DE FIM DE SEMANA ---
        // Se for a linha "FOLGA FDS", verificamos se a pessoa folga o fim de semana inteiro
        if (record.cargoKey === 'fds_folga') {
        const [y, m, d] = record.data.split('-').map(Number);
        const currentObj = new Date(y, m - 1, d);
        const dayOfWeek = currentObj.getDay();

        if (dayOfWeek === 6) { 
            const nextDay = new Date(y, m - 1, d + 1);
            const nextDayISO = nextDay.toISOString().split('T')[0];
            
            const hasSundayOff = cachedEvents.some(e => 
                e.nome === record.nome && e.data === nextDayISO && e.cargoKey === 'fds_folga'
            );

            // AJUSTE: Só esconde se não tiver Sunday Off E não for folga manual (referencia)
            if (!hasSundayOff && !record.referencia) shouldRender = false;

        } else if (dayOfWeek === 0) { 
            const prevDay = new Date(y, m - 1, d - 1);
            const prevDayISO = prevDay.toISOString().split('T')[0];

            const hasSaturdayOff = cachedEvents.some(e => 
                e.nome === record.nome && e.data === prevDayISO && e.cargoKey === 'fds_folga'
            );

            // AJUSTE: Só esconde se não tiver Saturday Off E não for folga manual (referencia)
            if (!hasSaturdayOff && !record.referencia) shouldRender = false;
        }
    }

        // Se passou no filtro, adiciona ao mapa para desenhar
        if (shouldRender) {
            const uniqueKey = `${record.data}|${record.cargoKey}`;
            if (!cellMap[uniqueKey]) cellMap[uniqueKey] = [];
            
            if (!cellMap[uniqueKey].includes(record.nome)) {
                cellMap[uniqueKey].push(record.nome);
            }
        }
    });

    // 3. Aplica no HTML
    Object.keys(cellMap).forEach(key => {
        const [dateISO, rowKey] = key.split('|');
        const [y, m, d] = dateISO.split('-');

        const dayInt = parseInt(d);
        const monthInt = parseInt(m);
        const yearInt = parseInt(y);

        const selector = `textarea[data-day="${dayInt}"][data-month="${monthInt}"][data-year="${yearInt}"][data-row="${rowKey}"]`;
        const textarea = document.querySelector(selector);

        if (textarea) {
            textarea.value = cellMap[key].join(' / ');
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        }
    });
}

function renderAllWeeks(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // LIMPEZA CRÍTICA: Garante que não sobrou lixo anterior
    container.innerHTML = ""; 

    const year = currentYear;
    const monthIndex = currentMonth - 1; 
    
    // --- MATEMÁTICA DA GRADE ---
    // A grade deve começar na segunda-feira da primeira semana
    // E terminar no domingo da última semana que contém dias deste mês.

    const firstDayOfMonth = new Date(year, monthIndex, 1);
    const dayOfWeek = firstDayOfMonth.getDay(); 
    const startOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    
    // Data Inicial do Grid (Pode ser final do mês anterior, ex: 29/Dez)
    let loopDate = new Date(year, monthIndex, 1 + startOffset);
    
    // Data Limite para parar de desenhar (Obrigatóriamente cobre o mês todo)
    // Se o mês acaba na terça, desenhamos até o domingo dessa semana.
    const lastDayOfMonth = new Date(year, monthIndex + 1, 0);
    
    // Loop Principal: Enquanto a data do loop for menor ou igual ao último dia do mês
    // OU se ainda não fechamos a semana (domingo)
    while (loopDate <= lastDayOfMonth || loopDate.getDay() !== 1) { // 1 = Segunda (parar quando for segunda e já tiver passado o mês)
        
        // Se já passamos do mês E é segunda-feira, PARE.
        if (loopDate > lastDayOfMonth && loopDate.getDay() === 1) break;

        // Coleta os 7 dias da semana atual
        const weekDates = [];
        for(let i=0; i<7; i++) {
            weekDates.push(new Date(loopDate));
            loopDate.setDate(loopDate.getDate() + 1); // Avança dia a dia
        }

        // Desenha esse bloco de semana
        createWeekBlock(container, weekDates);
    }
}

function createWeekBlock(container, dates) {
    const monday = dates[0];
    const mondayStr = monday.toISOString().split('T')[0];

    // 1. O Container Principal da Semana
    const wrapper = document.createElement("div");
    wrapper.className = "week-wrapper";
    wrapper.setAttribute('data-week-monday', mondayStr);
    
    // --- ESTILO DE COLUNA (Garante Título em Cima) ---
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column"; 
    wrapper.style.marginBottom = "30px"; // Espaço entre uma semana e outra

    // 2. O Título (Topo)
    const weekLabel = `📅 Semana de ${monday.getDate()}/${monday.getMonth()+1}`;
    const titleDiv = document.createElement("div");
    titleDiv.className = "week-header-title";
    titleDiv.innerHTML = weekLabel;
    
    // Estilo Bonito para o Título
    titleDiv.style.padding = "10px 15px";
    titleDiv.style.backgroundColor = "#f8f9fa"; 
    titleDiv.style.borderLeft = "5px solid #2980b9"; // Barrinha azul
    titleDiv.style.fontWeight = "bold";
    titleDiv.style.fontSize = "16px";
    titleDiv.style.color = "#2c3e50";
    titleDiv.style.marginBottom = "10px"; // Empurra as tabelas para baixo
    titleDiv.style.borderRadius = "4px";
    titleDiv.style.width = "fit-content"; // O fundo ocupa só o tamanho do texto (opcional)

    wrapper.appendChild(titleDiv);

    // 3. Container das Tabelas (Para ficarem lado a lado EMBAIXO do título)
    const tablesContainer = document.createElement("div");
    tablesContainer.className = "tables-row";
    tablesContainer.style.display = "flex";
    tablesContainer.style.gap = "15px"; // Espaço entre a tabela da semana e a do FDS
    tablesContainer.style.flexWrap = "wrap"; // Se a tela for pequena, o FDS cai pra baixo
    tablesContainer.style.alignItems = "flex-start";

    // Tabela Dias Úteis (Seg-Sex)
    const tableMain = document.createElement("div");
    tableMain.className = "week-main";
    tableMain.style.flex = "1"; // Ocupa o espaço disponível
    tableMain.innerHTML = generateTableHTML(dates.slice(0, 5), WEEKDAY_ROWS);
    
    // Tabela FDS (Sáb-Dom)
    const tableFds = document.createElement("div");
    tableFds.className = "week-weekend";
    tableFds.innerHTML = generateTableHTML(dates.slice(5, 7), WEEKEND_ROWS, true);

    // Adiciona as tabelas no container de tabelas
    tablesContainer.appendChild(tableMain);
    tablesContainer.appendChild(tableFds);

    // Adiciona o container de tabelas no wrapper principal
    wrapper.appendChild(tablesContainer);

    container.appendChild(wrapper);
}

function generateTableHTML(dates, rows, isWeekend = false) {
    let html = `<table class="escala-table-modern ${isWeekend ? 'weekend-table' : ''}">
        <thead>
            <tr>
                <th class="${isWeekend ? 'col-horario-fds' : 'col-cargo'}">${isWeekend ? 'HORÁRIO' : 'CARGO'}</th>
                ${!isWeekend ? '<th class="col-horario">HORÁRIO</th>' : ''}`;
    
    dates.forEach(d => {
        const dayName = d.toLocaleDateString('pt-BR', { weekday: 'short' }).toUpperCase().slice(0, 3);
        const isToday = d.toDateString() === new Date().toDateString();
        // Classe today-header para destaque visual
        html += `<th class="${isToday ? 'today-header' : ''}">${dayName}<br><small>${d.getDate()}/${d.getMonth()+1}</small></th>`;
    });
    
    html += `</tr></thead><tbody>`;

    rows.forEach(def => {
        if (def.type === 'header') {
            // Usa as classes header-manha/tarde do seu CSS para cores de fundo suaves
            html += `<tr class="${def.cssClass}"><td colspan="${dates.length + (isWeekend ? 1 : 2)}">${def.label}</td></tr>`;
        } else {
            html += `<tr class="${def.cssClass}">
                <td class="${isWeekend ? 'time-cell-fds' : 'cargo-cell'}"><strong>${def.label}</strong></td>
                ${!isWeekend ? `<td class="time-cell">${def.time}</td>` : ''}`;
            
            if (isWeekend && def.key === 'fds_folga') {
                const d = dates[0]; 
                const y = d.getFullYear();
                const m = d.getMonth() + 1;
                const _d = d.getDate();

                // Célula unificada para folga de fim de semana com estilo de destaque
                html += `
                <td colspan="${dates.length}" class="cell-fds-folga">
                    <textarea class="escala-input bold-red" rows="1" 
                        data-day="${_d}" data-month="${m}" data-year="${y}" data-row="${def.key}"
                        onblur="window.saveManualEdit(this)"
                        oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
                </td>`;
            } else {
                dates.forEach(d => {
                    const y = d.getFullYear();
                    const m = d.getMonth() + 1;
                    const _d = d.getDate();
                    
                    html += `<td>
                        <textarea class="escala-input" rows="1"
                            data-day="${_d}" data-month="${m}" data-year="${y}" data-row="${def.key}"
                            onblur="window.saveManualEdit(this)"
                            oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
                    </td>`;
                });
            }
            html += `</tr>`;
        }
    });
    html += `</tbody></table>`;
    return html;
}

// =========================================================
// 4. AUTOMATIZAÇÃO GERAL
// =========================================================

window.autoFillCycle = async function() {
    
    // 1. Variáveis Iniciais
    const startOfViewedMonth = new Date(currentYear, currentMonth - 1, 1);
    
    const { value: mode } = await Swal.fire({
        title: '✨ Gerar Escala Automática',
        html: `Início: <b>01/${currentMonth}/${currentYear}</b><br><br>`,
        input: 'select',
        inputOptions: { 'month': 'Preencher Apenas este Mês', 'year': 'Preencher até o Final do Ano' },
        inputPlaceholder: 'Selecione o período...',
        showCancelButton: true,
        confirmButtonColor: '#27ae60'
    });
    
    if (!mode) return;

    if(window.showToast) window.showToast("Iniciando Automação...", "info");
    console.clear();
    console.log(`=== AUTOMAÇÃO GERAL (Início: ${startOfViewedMonth.toLocaleDateString()}) ===`);

    try {
        // 2. Carregamentos do Banco
        const usersSnap = await getDocs(collection(db, "users"));
        const usersDB = [];
        usersSnap.forEach(doc => {
            const d = doc.data();
            if (d.Nome) usersDB.push({ fullName: d.Nome, normName: normalizeText(d.Nome), startDate: d.cycleStartDate });
        });

        const feriasSnap = await getDocs(collection(db, "ferias_registros"));
        const feriasDB = [];
        feriasSnap.forEach(doc => feriasDB.push(doc.data()));

        const feriadosSnap = await getDocs(collection(db, "feriados_config"));
        const holidayMap = {}; 
        feriadosSnap.forEach(doc => holidayMap[doc.id] = doc.data());

        const rotationRef = doc(db, "settings", "feriado_rotation");
        const rotationSnap = await getDoc(rotationRef);
        let rotationState = rotationSnap.exists() ? rotationSnap.data() : { manha: 0, tarde: 0, supervisor: 0 };

        // Carrega registros existentes para evitar sobreposição (CORREÇÃO DE DUPLICIDADE)
        const existingQ = query(
            collection(db, "escala_individual"), // Certifique-se que esta constante está definida no topo do arquivo, senão use "escala_individual" string
            where("data", ">=", startOfViewedMonth.toISOString().split('T')[0])
        );
        const existingSnap = await getDocs(existingQ);
        const absenceMap = {}; // <--- AQUI ESTÁ A VARIÁVEL QUE FALTAVA
        
        existingSnap.forEach(doc => {
            const d = doc.data();
            // Mapeia quem tem férias ou folga
            if (d.cargoKey === 'ferias' || d.cargoKey === 'folga' || d.cargoKey === 'fds_folga') {
                if (!absenceMap[d.data]) absenceMap[d.data] = [];
                absenceMap[d.data].push(d.nome); 
            }
        });
        
        // 3. Inicializa Batch
        let batch = writeBatch(db); 
        let operationCount = 0;
        
        // --- FUNÇÕES AUXILIARES ---
        function addToBatch(date, name, key, isFeriado, needsCompensacao = false) {
            // CORREÇÃO: Se já tem folga/férias nesse dia, NÃO adiciona na escala
            if (absenceMap[date] && absenceMap[date].includes(name)) {
                console.log(`Pulando ${name} em ${date} pois tem Folga/Férias`);
                return; 
            }

            const docId = `${date}_${normalizeText(name).replace(/\s/g, '')}`;
            const dataToSave = {
                data: date, 
                nome: name, 
                cargoKey: key, 
                updatedAt: serverTimestamp()
            };
            if (isFeriado) dataToSave.isFeriadoEscalado = true;
            if (needsCompensacao) dataToSave.precisaCompensacao = true;
            
            batch.set(doc(db, "escala_individual", docId), dataToSave, { merge: true });
            operationCount++;
        }

        async function checkBatch() {
            if (operationCount >= 400) {
                await batch.commit();
                batch = writeBatch(db); 
                operationCount = 0;
            }
        }
        // ---------------------------

        let daysToRun = mode === 'month' ? 35 : 365;
        let cursor = new Date(startOfViewedMonth);
        cursor.setHours(12,0,0,0); 

        // 4. Loop Principal
        for (let i = 0; i < daysToRun; i++) {
            const dateISO = cursor.toISOString().split('T')[0];
            const dayOfWeek = cursor.getDay(); 
            const holiday = holidayMap[dateISO];

            // =================================================================
            // 🛑 CENÁRIO 1: É FERIADO DE **DIA DE SEMANA**? (Seg=1 a Sex=5)
            // =================================================================
            if (holiday && dayOfWeek >= 1 && dayOfWeek <= 5) {
                console.log(`[FERIADO SEMANA] ${dateISO} - Aplicando Roda Especial`);
                
                if (holiday.tipo !== 'TOTAL') { 
                    
                    // --- IDs DAS LINHAS (CONFIRA SE ESTÃO CERTOS NO SEU CONFIG) ---
                    const KEY_MANHA_6H = 'atend_08_14'; // Linha 08h-14h
                    const KEY_TARDE_6H = 'atend_14_20'; // Linha 14h-20h
                    const KEY_SUPERVISOR = 'supervisor1';      // Linha Supervisor 1
                    // --------------------------------------------------------------

                    // A. Roda Atendentes Manhã (Pega 2)
                    const idxM1 = rotationState.manha % RODA_FERIADO_MANHA.length;
                    const idxM2 = (rotationState.manha + 1) % RODA_FERIADO_MANHA.length;
                    
                    addToBatch(dateISO, RODA_FERIADO_MANHA[idxM1], KEY_MANHA_6H, true, true);
                    addToBatch(dateISO, RODA_FERIADO_MANHA[idxM2], KEY_MANHA_6H, true, true);
                    rotationState.manha += 2;

                    // B. Roda Atendentes Tarde (Pega 2)
                    const idxT1 = rotationState.tarde % RODA_FERIADO_TARDE.length;
                    const idxT2 = (rotationState.tarde + 1) % RODA_FERIADO_TARDE.length;
                    
                    addToBatch(dateISO, RODA_FERIADO_TARDE[idxT1], KEY_TARDE_6H, true, true);
                    addToBatch(dateISO, RODA_FERIADO_TARDE[idxT2], KEY_TARDE_6H, true, true);
                    rotationState.tarde += 2;

                    // C. Roda Supervisoras (Pega APENAS 1)
                    const currentSupIdx = (rotationState.supervisor || 0);
                    const idxSup = currentSupIdx % RODA_SUPERVISOR.length;
                    
                    addToBatch(dateISO, RODA_SUPERVISOR[idxSup], KEY_SUPERVISOR, true, true);
                    rotationState.supervisor = currentSupIdx + 1;
                }
                
                // === O SEGREDO ESTÁ AQUI ===
                // Salva o que fizemos e PULA para o próximo dia imediatamente.
                // Isso impede que o código desça e escale Elaine, João ou os horários de 8h.
                await checkBatch();
                cursor.setDate(cursor.getDate() + 1);
                continue; 
            }
            
            // =================================================================
            // ⏩ CENÁRIO 2: ESCALA PADRÃO (Dias Normais OU Feriados FDS)
            // =================================================================
            // Se chegou aqui, OU não é feriado, OU é feriado de Sábado/Domingo.
            
            const isWeekendHoliday = (holiday && (dayOfWeek === 0 || dayOfWeek === 6));

            for (const [shortName, profileType] of Object.entries(EMPLOYEE_PROFILES)) {
                const fullNameTarget = NAME_MAPPING[shortName] || shortName;
                const normTarget = normalizeText(fullNameTarget);
                
                // Verifica Férias
                const isOnVacation = feriasDB.some(f => 
                    f.normName.includes(normTarget) && dateISO >= f.start && dateISO <= f.end
                );

                if (isOnVacation) {
                    addToBatch(dateISO, shortName, 'ferias', false);
                    continue; 
                }

                // Calcula Escala Normal
                let targetRow = null;
                if (profileType.startsWith('FIXO_')) {
                    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
                        if (profileType === 'FIXO_GERENCIA') targetRow = 'gerencia';
                        else if (profileType === 'FIXO_ANALISTA') targetRow = 'analista';
                        else if (profileType === 'FIXO_SUPERVISOR1') targetRow = 'supervisor1';
                        else if (profileType === 'FIXO_SUPERVISOR2') targetRow = 'supervisor2';
                    }
                } else {
                    const userConfig = usersDB.find(u => u.normName.includes(normTarget));
                    if (userConfig && userConfig.startDate) {
                        const distToMonday = (dayOfWeek + 6) % 7; 
                        const mondayOfThisWeek = new Date(cursor);
                        mondayOfThisWeek.setDate(cursor.getDate() - distToMonday);
                        const mondayISO = mondayOfThisWeek.toISOString().split('T')[0];

                        const stageIndex = getCycleStage(userConfig.startDate, mondayISO);
                        const stageData = ESCALA_CYCLE[stageIndex];

                        if (stageData) {
                            if (dayOfWeek >= 1 && dayOfWeek <= 5) { 
                                const rules = SHIFT_RULES[profileType];
                                targetRow = rules ? rules[stageData.carga] : null;
                            } else if (dayOfWeek === 6) targetRow = getRowKeyForSchedule(stageData.sabado);
                            else if (dayOfWeek === 0) targetRow = getRowKeyForSchedule(stageData.domingo);
                        }
                    }
                }

                if (targetRow) {
                    // Se for feriado de FDS, marca compensação. Se for dia normal, false.
                    addToBatch(dateISO, shortName, targetRow, isWeekendHoliday, isWeekendHoliday);
                }
            }

            await checkBatch();
            cursor.setDate(cursor.getDate() + 1);
        }

        // 5. Finalização
        await setDoc(rotationRef, rotationState);
        if (operationCount > 0) await batch.commit();

        if(window.showToast) window.showToast("Escala gerada com sucesso!", "success");
        setTimeout(() => loadEscala(), 1500);

    } catch (e) {
        console.error("ERRO:", e);
        Swal.fire("Erro", "Falha na automação: " + e.message, "error");
    }
};

// ------------------------------------------------------------------
// 5. SALVAMENTO MANUAL (SYNC VISUAL -> BANCO)
// ------------------------------------------------------------------
// Quando você edita o texto na mão, precisamos atualizar os registros individuais

window.saveManualEdit = async function(textarea) {
    const d = textarea.getAttribute('data-day').padStart(2, '0');
    const m = textarea.getAttribute('data-month').padStart(2, '0');
    const y = textarea.getAttribute('data-year');
    const rowKey = textarea.getAttribute('data-row');
    const dateISO = `${y}-${m}-${d}`;

    const newText = textarea.value;
    const names = newText.split('/').map(n => n.trim()).filter(n => n !== "");

    // Essa parte é delicada: Sincronizar texto livre com banco estruturado.
    // 1. Busca quem JÁ ESTAVA nesse dia/linha
    const q = query(
        collection(db, ESCALA_INDIVIDUAL_COLLECTION),
        where("data", "==", dateISO),
        where("cargoKey", "==", rowKey)
    );
    const snap = await getDocs(q);
    const existingDocs = [];
    snap.forEach(d => existingDocs.push({ id: d.id, nome: d.data().nome }));

    const batch = writeBatch(db);

    // 2. Quem remover? (Estava no banco, não está no texto)
    existingDocs.forEach(ex => {
        if (!names.includes(ex.nome)) {
            batch.delete(doc(db, ESCALA_INDIVIDUAL_COLLECTION, ex.id));
        }
    });

    // 3. Quem adicionar? (Está no texto, não estava no banco)
    names.forEach(name => {
        const alreadyThere = existingDocs.find(ex => ex.nome === name);
        if (!alreadyThere) {
            // Cria novo doc
            const docId = `${dateISO}_${normalizeText(name).replace(/\s/g, '')}`;
            batch.set(doc(db, ESCALA_INDIVIDUAL_COLLECTION, docId), {
                data: dateISO,
                nome: name,
                cargoKey: rowKey,
                updatedAt: serverTimestamp()
            });
        }
    });

    await batch.commit();
    if(window.showToast) window.showToast("Salvo!");
};

// Helpers
function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
}

function getRowKeyForSchedule(s) {
    if (!s) return null;
    s = s.toLowerCase();
    if (s.includes("folga")) return 'fds_folga'; // ou 'folga'
    if ((s.includes("8") || s.includes("08")) && s.includes("14")) return 'fds_8_14';
    if (s.includes("10") && s.includes("16")) return 'fds_10_16';
    if (s.includes("12") && s.includes("18")) return 'fds_12_18';
    // Fallbacks
    if (s.includes("8") || s.includes("08")) return 'fds_8_14';
    if (s.includes("12") || s.includes("14")) return 'fds_12_18';
    return null;
}

// Funções globais necessárias
window.changeEscalaMonth = function(delta) {
    currentMonth += delta;
    
    // Ajuste de virada de ano
    if (currentMonth > 12) { 
        currentMonth = 1; 
        currentYear++; 
    } else if (currentMonth < 1) { 
        currentMonth = 12; 
        currentYear--; 
    }

    // 1. Atualiza o texto do mês no topo
    renderMonthLabel();

    // 2. Verifica se o Editor está aberto ou se estamos na Visualização
    const editorWrapper = document.getElementById('escala-editor-wrapper');
    const isEditorOpen = editorWrapper && !editorWrapper.classList.contains('hidden');

    if (isEditorOpen) {
        // Se estiver editando, carrega a grade de inputs
        loadEscala(); 
    } else {
        // Se estiver apenas lendo, carrega os cards de visualização
        if (window.loadReadOnlyView) window.loadReadOnlyView();
    }
};

async function loadEmployeeList() {
    // 1. Seleciona o container (ajuste o seletor se necessário)
    const listContainer = document.querySelector('.equipe-list-container') || document.getElementById('employees-list') || document.getElementById('external-events');
    
    if(!listContainer) return;

    // Feedback visual
    listContainer.innerHTML = '<div style="padding:10px; color:#666; text-align:center;">Carregando equipe...</div>';

    try {
        // 2. Busca Usuários - FILTRADO PARA PUXAR APENAS SETOR 'cobranca'
        // Utilizamos "array-contains" pois o campo 'sectors' é um array no seu banco de dados
        const q = query(collection(db, "users"), where("sectors", "array-contains", "cobranca")); 
        const querySnapshot = await getDocs(q);
        
        let fullEmployeeData = []; // Lista temporária com objetos completos
        
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            // Só adiciona se tiver Nome
            if (data.Nome && data.Nome.trim() !== "") {
                fullEmployeeData.push({
                    id: doc.id,
                    Nome: data.Nome.trim(),
                    Cargo: data.Cargo || '',
                    Email: data.Email || '',
                    Setor: data.Setor || ''
                });
            }
        });

        // 3. Ordena Alfabeticamente
        fullEmployeeData.sort((a, b) => a.Nome.localeCompare(b.Nome));

        // 4. Renderiza os Cards
        listContainer.innerHTML = ''; // Limpa o "Carregando..."
        
        if (fullEmployeeData.length === 0) {
            listContainer.innerHTML = '<div style="padding:10px; color:#999;">Nenhum funcionário de cobrança encontrado.</div>';
            return;
        }

        fullEmployeeData.forEach(user => {
            // Cria o elemento do Card
            const card = document.createElement('div');
            card.className = 'employee-card';
            card.setAttribute('draggable', 'true');
            
            // Monta o HTML interno
            card.innerHTML = `
                <div class="card-name">${user.Nome}</div>
                <div class="card-detail"> ${user.Email || '-'}</div>
            `;

            // --- A MÁGICA DO ARRASTAR (DRAG & DROP) ---
            card.addEventListener('dragstart', (e) => {
                // Pega apenas o PRIMEIRO NOME
                const firstName = user.Nome.split(' ')[0];
                
                // Define o que será "colado" na tabela
                e.dataTransfer.setData('text/plain', firstName);
                e.dataTransfer.effectAllowed = 'copy';
                
                // (Opcional) Visual: Deixa o card meio transparente ao arrastar
                card.style.opacity = '0.5';
            });

            card.addEventListener('dragend', () => {
                card.style.opacity = '1'; // Volta ao normal
            });

            listContainer.appendChild(card);
        });

    } catch (error) {
        console.error("Erro ao carregar equipe:", error);
        listContainer.innerHTML = '<div style="color:red; padding:10px;">Erro ao carregar lista.</div>';
    }
}

// =========================================================
// 6. CONTROLE DE INTERFACE (ABRIR/FECHAR EDITOR)
// =========================================================

window.openEscalaEditor = async function () {
    const viewContainer = document.getElementById("escala-view-container");
    const editorWrapper = document.getElementById("escala-editor-wrapper");
    const editBtn = document.getElementById("btn-open-editor");

    // Esconde a visualização e mostra o editor usando classes
    if (viewContainer) viewContainer.classList.add('hidden');
    if (editBtn) editBtn.classList.add('hidden');
    
    if (editorWrapper) {
        editorWrapper.classList.remove('hidden'); // Remove a classe que esconde
        // Garante que a tabela seja desenhada no contêiner correto
        await loadEscala(); 
    }
};

window.closeEscalaEditor = function () {
    const viewContainer = document.getElementById("escala-view-container");
    const editorWrapper = document.getElementById("escala-editor-wrapper");
    const editBtn = document.getElementById("btn-open-editor");

    // Inverte o processo
    if (editorWrapper) editorWrapper.classList.add('hidden');
    if (viewContainer) viewContainer.classList.remove('hidden');
    if (editBtn) editBtn.classList.remove('hidden');
    
    // Recarrega a visualização de leitura
    if (window.loadReadOnlyView) window.loadReadOnlyView();
};

// Função para recolher/expandir a lateral da equipe no editor
window.toggleEscalaSidebar = function() {
    const sidebar = document.getElementById('escala-sidebar-staff');
    const icon = document.getElementById('sidebar-toggle-icon');
    
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
        
        // Altera o ícone conforme o estado
        if (sidebar.classList.contains('collapsed')) {
            icon.className = 'fas fa-users'; // Ícone para "mostrar equipe"
        } else {
            icon.className = 'fas fa-users-slash'; // Ícone para "esconder equipe"
        }
    }
};

// =========================================================
// 7. CONFIGURADOR DE CICLOS (ECONÔMICO DE QUOTA)
// =========================================================

window.openCycleConfigurator = async function() {
    // 1. Carrega lista de funcionários para o Select (Leitura Otimizada)
    if(window.showToast) window.showToast("Carregando equipe...", "info");
    
    let usersOptions = "";
    try {
        const q = query(collection(db, "users"), where("sectors", "array-contains", "cobranca"));
        const snapshot = await getDocs(q);
        
        // Cria as opções do Dropdown ordenadas
        const users = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            if (d.Nome) users.push({ id: doc.id, nome: d.Nome });
        });
        users.sort((a, b) => a.nome.localeCompare(b.nome));
        
        users.forEach(u => {
            usersOptions += `<option value="${u.id}">${u.nome}</option>`;
        });
        
    } catch (e) {
        console.error(e);
        return Swal.fire("Erro", "Cota excedida ou erro de permissão ao ler usuários.", "error");
    }

    // 2. Abre o Popup Visual
    const { value: formValues } = await Swal.fire({
        title: '⚙️ Configurar Ciclo Individual',
        html: `
            <div style="text-align:left; font-size:14px;">
                <label style="font-weight:bold;">1. Selecione a Atendente:</label>
                <select id="swal-emp" class="swal2-input" style="margin-top:5px;">
                    ${usersOptions}
                </select>

                <label style="font-weight:bold; display:block; margin-top:15px;">2. Data de Referência (Segunda-feira):</label>
                <input type="date" id="swal-date" class="swal2-input" style="margin-top:5px;">
                <small style="color:#666;">Escolha a segunda-feira desta semana.</small>

                <label style="font-weight:bold; display:block; margin-top:15px;">3. Qual horário ela faz ESSA semana?</label>
                <select id="swal-stage" class="swal2-input" style="margin-top:5px;">
                    <option value="0">Semana 1 (8h + Trab. Domingo)</option>
                    <option value="1">Semana 2 (6h + Folga FDS)</option>
                    <option value="2">Semana 3 (8h + Folga FDS)</option>
                    <option value="3">Semana 4 (6h + Sáb 08h-14h)</option>
                    <option value="4">Semana 5 (6h + Sáb 12h-18h)</option>
                </select>
            </div>
        `,
        focusConfirm: false,
        preConfirm: () => {
            return {
                userId: document.getElementById('swal-emp').value,
                dateRef: document.getElementById('swal-date').value,
                stageIndex: parseInt(document.getElementById('swal-stage').value)
            }
        }
    });

    if (!formValues) return;
    if (!formValues.dateRef) return Swal.fire("Erro", "Selecione uma data.", "warning");

    // 3. MATEMÁTICA REVERSA (O Pulo do Gato)
    // Se hoje é semana 3, quando foi a semana 0? Resposta: 3 semanas atrás.
    const refDate = new Date(formValues.dateRef);
    // Subtrai (Estágio * 7 dias) para achar o início do ciclo
    refDate.setDate(refDate.getDate() - (formValues.stageIndex * 7));
    
    const calculatedStartDate = refDate.toISOString().split('T')[0];

    // 4. Salva no Banco (Apenas 1 Escrita)
    try {
        const userRef = doc(db, "users", formValues.userId);
        await updateDoc(userRef, {
            cycleStartDate: calculatedStartDate
        });

        Swal.fire({
            icon: 'success',
            title: 'Ciclo Configurado!',
            text: `O sistema calculou que o ciclo iniciou em: ${calculatedStartDate}. Agora o Auto Ciclo funcionará para esta pessoa.`
        });

    } catch (e) {
        console.error(e);
        Swal.fire("Erro ao salvar", "Verifique se a cota do Firebase permite gravações.", "error");
    }
};

// =========================================================
// 8. GERENCIADOR DE FÉRIAS
// =========================================================

window.openVacationConfigurator = async function() {
    // 1. Carrega Usuários
    if(window.showToast) window.showToast("Carregando...", "info");
    
    let usersOptions = "";
    try {
        const q = query(collection(db, "users"), where("sectors", "array-contains", "cobranca"));
        const snapshot = await getDocs(q);
        const users = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            if (d.Nome) users.push({ id: doc.id, nome: d.Nome });
        });
        users.sort((a, b) => a.nome.localeCompare(b.nome));
        users.forEach(u => usersOptions += `<option value="${u.nome}">${u.nome}</option>`); // Usamos o Nome como valor
    } catch (e) {
        console.error(e);
        return;
    }

    // 2. Popup
    const { value: formValues } = await Swal.fire({
        title: '🏖️ Registrar Férias',
        html: `
            <div style="text-align:left;">
                <label>Atendente:</label>
                <select id="vac-name" class="swal2-input">${usersOptions}</select>
                
                <label>Data Início:</label>
                <input type="date" id="vac-start" class="swal2-input">
                
                <label>Data Fim (inclusive):</label>
                <input type="date" id="vac-end" class="swal2-input">
            </div>
        `,
        focusConfirm: false,
        preConfirm: () => {
            return {
                nome: document.getElementById('vac-name').value,
                start: document.getElementById('vac-start').value,
                end: document.getElementById('vac-end').value
            }
        }
    });

    if (!formValues) return;
    if (!formValues.start || !formValues.end) return Swal.fire("Erro", "Preencha as datas.", "error");

    // 3. APLICA AS FÉRIAS (Substitui Trabalho por Férias no período)
    await applyVacationRange(formValues.nome, formValues.start, formValues.end);
};

// js/escala.js

async function applyVacationRange(nomeCompleto, startStr, endStr) {
    if(window.showToast) window.showToast("Aplicando férias na escala...", "info");

    // 1. Descobre o Nome Curto (Apelido) para usar na célula
    // Tenta achar no Mapeamento REVERSO (Valor -> Chave) ou usa o primeiro nome
    let shortName = nomeCompleto.split(' ')[0]; // Padrão: Primeiro nome (Ex: Fabiana)
    
    // Tenta achar se existe um mapeamento específico (Ex: Maria Julia -> Júlia)
    const entry = Object.entries(NAME_MAPPING).find(([key, value]) => value === nomeCompleto);
    if (entry) {
        shortName = entry[0]; // Usa a chave (Ex: Júlia)
    }

    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    
    startDate.setHours(12,0,0,0);
    endDate.setHours(12,0,0,0);

    let batch = writeBatch(db);
    let count = 0;
    
    // 2. Salva o Registro Mestre (Mantém nome completo para busca segura)
    const feriasRef = doc(db, "ferias_registros", `${normalizeText(nomeCompleto)}_${startStr}`);
    batch.set(feriasRef, {
        nome: nomeCompleto,
        normName: normalizeText(nomeCompleto),
        start: startStr,
        end: endStr,
        createdAt: serverTimestamp()
    });

    // 3. Salva na Escala Individual (Visual) usando o SHORT NAME
    let cursor = new Date(startDate);
    while (cursor <= endDate) {
        const dateISO = cursor.toISOString().split('T')[0];
        
        // ID Único usando o ShortName para garantir que substitui o registro de trabalho
        const docId = `${dateISO}_${normalizeText(shortName).replace(/\s/g, '')}`;
        const docRef = doc(db, "escala_individual", docId);

        batch.set(docRef, {
            data: dateISO,
            nome: shortName, // <--- AQUI ESTAVA O PROBLEMA, AGORA USA O CURTO
            cargoKey: 'ferias',
            updatedAt: serverTimestamp()
        });

        count++;
        cursor.setDate(cursor.getDate() + 1);
    }

    await batch.commit();
    
    if(window.showToast) window.showToast("Férias registradas!", "success");
    setTimeout(() => loadEscala(), 1000);
}

// =========================================================
// 9. MODO DE VISUALIZAÇÃO (LEITURA APENAS)
// =========================================================

window.loadReadOnlyView = async function() {
    const container = document.getElementById('escala-view-content');
    if (!container) {
        console.error("Erro: Container 'escala-view-content' não encontrado no HTML.");
        return;
    }

    container.innerHTML = '<div style="text-align:center; padding:50px;"><i class="fas fa-circle-notch fa-spin fa-2x"></i><br>Carregando visualização...</div>';

    try {
        const year = currentYear;
        const monthIndex = currentMonth - 1;

        // Cálculo das datas limites (Mesma lógica do editor)
        const firstDay = new Date(year, monthIndex, 1);
        const startOffset = firstDay.getDay() === 0 ? -6 : 1 - firstDay.getDay();
        const startDate = new Date(year, monthIndex, 1 + startOffset);
        
        const lastDay = new Date(year, monthIndex + 1, 0);
        const endOffset = lastDay.getDay() === 0 ? 0 : 7 - lastDay.getDay();
        const endDate = new Date(year, monthIndex + 1, 0 + endOffset);

        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        // Busca no Firestore
        const q = query(
            collection(db, "escala_individual"), 
            where("data", ">=", startStr),
            where("data", "<=", endStr)
        );
        const snapshot = await getDocs(q);
        const events = [];
        snapshot.forEach(doc => events.push(doc.data()));

        // Limpa o loader
        container.innerHTML = "";

        // Título do Mês na Visualização
        const monthTitle = firstDay.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
        console.log(`Renderizando visualização para: ${monthTitle}`);

        // Chama a montagem das semanas
        renderReadOnlyTable(container, startDate, endDate, events);

    } catch (err) {
        console.error("Erro ao carregar visualização:", err);
        container.innerHTML = '<div class="alert-error">Erro ao renderizar tabela de leitura.</div>';
    }
};

// 2. Monta as tabelas semanais (Mantendo o agrupamento de nomes + referências)
function renderReadOnlyTable(container, startDate, endDate, events) {
    let loopDate = new Date(startDate);
    
    // Organiza os dados em um mapa para acesso rápido
    const dataMap = {};
    if (Array.isArray(events)) {
        events.forEach(e => {
            const key = `${e.data}_${e.cargoKey}`;
            if (!dataMap[key]) dataMap[key] = [];
            
            // CORREÇÃO: Mapeia explicitamente 'referencia' para 'ref'
            if (!dataMap[key].some(item => item.nome === e.nome)) {
                dataMap[key].push({ 
                    nome: e.nome, 
                    ref: e.referencia || null 
                });
            }
        });
    }

    // Loop de Semanas
    while (loopDate <= endDate) {
        const weekDates = [];
        for (let i = 0; i < 7; i++) {
            weekDates.push(new Date(loopDate));
            loopDate.setDate(loopDate.getDate() + 1);
        }

        const f = (d) => `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        
        const wrapper = document.createElement("div");
        wrapper.className = "week-wrapper-readonly"; // Classe do seu novo CSS
        
        // Estrutura de Card Moderna
        wrapper.innerHTML = `
            <div class="week-header-title">
                <i class="fas fa-calendar-alt"></i> Semana de ${f(weekDates[0])} a ${f(weekDates[6])}
            </div>
            <div class="tables-row">
                <div class="week-main">
                    ${generateStaticHTML(weekDates.slice(0, 5), WEEKDAY_ROWS, false, dataMap)}
                </div>
                <div class="week-weekend">
                    ${generateStaticHTML(weekDates.slice(5, 7), WEEKEND_ROWS, true, dataMap)}
                </div>
            </div>
        `;

        container.appendChild(wrapper);
        
        // Evita loop infinito se ultrapassar o mês e for segunda
        if (loopDate > endDate && loopDate.getDay() === 1) break;
    }
}

// =========================================================
// 10. CONFIGURADOR DE FERIADOS (JANELA DE GERENCIAMENTO)
// =========================================================

// Função principal que abre a janela
window.openHolidayConfigurator = async function() {
    // Lista feriados existentes para visualização rápida (Opcional, mas útil)
    let holidaysListHTML = '<div style="max-height:100px; overflow-y:auto; margin-bottom:15px; border:1px solid #eee; padding:5px;">';
    if (window.feriadosCache) {
        Object.entries(window.feriadosCache).sort().forEach(([date, data]) => {
            const [y, m, d] = date.split('-');
            holidaysListHTML += `<div style="font-size:12px; border-bottom:1px solid #f0f0f0; padding:3px;">
                <b>${d}/${m}</b>: ${data.nome} <span style="color:#999">(${data.tipo})</span>
                <span style="color:red; cursor:pointer; float:right;" onclick="deleteHoliday('${date}')">✖</span>
            </div>`;
        });
    }
    holidaysListHTML += '</div>';

    const { value: formValues } = await Swal.fire({
        title: '📅 Configurar Feriados',
        html: `
            <div class="swal-modern-form holiday-theme">
                ${holidaysListHTML}
                
                <div class="swal-input-group">
                    <label class="swal-custom-label">Nome do Feriado</label>
                    <input id="hol-name" class="swal-custom-input" placeholder="Ex: Tiradentes">
                </div>

                <div class="swal-input-group">
                    <label class="swal-custom-label">Data</label>
                    <input type="date" id="hol-date" class="swal-custom-input">
                </div>

                <div class="swal-input-group">
                    <label class="swal-custom-label">Tipo de Impacto</label>
                    <select id="hol-type" class="swal-custom-input">
                        <option value="TOTAL">Total (Ninguém trabalha)</option>
                        <option value="PARCIAL">Parcial (Escala de Feriado)</option>
                    </select>
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Adicionar Feriado',
        cancelButtonText: 'Fechar',
        confirmButtonColor: '#8e44ad',
        preConfirm: () => ({
            nome: document.getElementById('hol-name').value,
            data: document.getElementById('hol-date').value,
            tipo: document.getElementById('hol-type').value
        })
    });

    if (!formValues) return;
    if (!formValues.nome || !formValues.data) return Swal.fire("Erro", "Preencha nome e data.", "error");

    try {
        await setDoc(doc(db, "feriados_config", formValues.data), {
            nome: formValues.nome,
            tipo: formValues.tipo,
            updatedAt: serverTimestamp()
        });
        
        // Recarrega feriados na memória
        const q = query(collection(db, "feriados_config"));
        const snap = await getDocs(q);
        window.feriadosCache = {};
        snap.forEach(doc => window.feriadosCache[doc.id] = doc.data());

        Swal.fire("Sucesso", "Feriado adicionado!", "success").then(() => {
            // Reabre para adicionar outro se quiser, ou atualiza a tela
            loadEscala();
            calculateYearlyCompOffs();
        });
    } catch (e) {
        console.error(e);
        Swal.fire("Erro", "Falha ao salvar.", "error");
    }
};

// Função auxiliar para deletar (precisa estar no window para o onclick do HTML funcionar)
window.deleteHoliday = async function(id) {
    try {
        await deleteDoc(doc(db, "feriados_config", id));
        
        // Remove do cache global também
        if (window.feriadosCache) delete window.feriadosCache[id];

        // Reabre a janela para atualizar a lista visualmente
        window.openHolidayConfigurator();
        
    } catch (e) {
        console.error(e);
        alert("Erro ao excluir.");
    }
};

// Gerador de HTML Estático (Sem Inputs)
function generateStaticHTML(dates, rows, isWeekend, dataMap, myShortName) {
    const normalize = (str) => str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() : "";
    const myNorm = normalize(myShortName);

    // A tabela recebe a classe 'weekend-table' se for sábado/domingo para o CSS aplicar o tema coral
    let html = `<table class="escala-table-modern ${isWeekend ? 'weekend-table' : ''}">
        <thead><tr>
            <th class="${isWeekend ? 'col-horario-fds' : 'col-cargo'}">${isWeekend ? 'HORÁRIO' : 'CARGO'}</th>
            ${!isWeekend ? '<th class="col-horario">HORÁRIO</th>' : ''}`;
    
    dates.forEach(d => {
        const dayName = d.toLocaleDateString('pt-BR', { weekday: 'short' }).toUpperCase().slice(0, 3);
        const isToday = d.toDateString() === new Date().toDateString();
        
        // Verificação de Mês para aplicar o efeito "apagado" (fade)
        const isCurrentViewMonth = d.getMonth() === (currentMonth - 1);
        
        const isoHeader = d.toISOString().split('T')[0];
        const feriadoData = window.feriadosCache && window.feriadosCache[isoHeader];

        let thClass = isToday ? 'today-header' : '';
        let holidayNameHtml = '';

        if (feriadoData) {
        thClass += ' header-feriado';
        // Adiciona o nome do feriado no cabeçalho
        holidayNameHtml = `<span class="holiday-name-label">${feriadoData.nome}</span>`;
        }

        if (!isCurrentViewMonth) thClass += ' month-fade';

        // Adiciona o nome do feriado abaixo da data
        html += `<th class="${thClass}">
        ${dayName}<br>
        <small>${d.getDate()}/${d.getMonth()+1}</small>
        ${holidayNameHtml}
        </th>`;
            });
    
    html += `</tr></thead><tbody>`;

    rows.forEach(def => {
        if (def.type === 'header') {
            // Ajusta o colspan dinamicamente para não quebrar o layout entre semana e FDS
            html += `<tr class="${def.cssClass}"><td colspan="${dates.length + (isWeekend ? 1 : 2)}"><b>${def.label}</b></td></tr>`;
        } else {
            html += `<tr class="${def.cssClass}">
                <td class="${isWeekend ? 'time-cell-fds' : 'cargo-cell'}"><strong>${def.label}</strong></td>
                ${!isWeekend ? `<td class="time-cell">${def.time}</td>` : ''}`;
            
            // Lógica para a linha unificada de FOLGA FDS
            if (isWeekend && def.key === 'fds_folga') {
                const satISO = dates[0].toISOString().split('T')[0];
                const sunISO = dates[1].toISOString().split('T')[0];
                const satData = dataMap[`${satISO}_fds_folga`] || [];
                const sunData = dataMap[`${sunISO}_fds_folga`] || [];
                
                // Filtra quem está de folga o FDS inteiro (presente no Sábado e no Domingo)
                const fullWeekendOff = satData.filter(s => sunData.some(sun => sun.nome === s.nome));
                
                const formattedNames = fullWeekendOff.map(item =>
                    // ADICIONE def.key como o 5º argumento aqui
                    renderNameWithRef(item, myNorm, normalize, 'my-name-highlight', def.key)
                ).join(' / ');

                html += `<td colspan="2" class="cell-fds-folga-static">${formattedNames || '-'}</td>`;
            } else {
                dates.forEach(d => {
                const iso = d.toISOString().split('T')[0];
                const key = `${iso}_${def.key}`;
                let rawData = dataMap[key] || [];
                const isToday = d.toDateString() === new Date().toDateString();
                
                // --- NOVA REGRA INJETADA: FERIADO PARCIAL SEMANA ---
                const dayOfWeek = d.getDay(); // 1 (Seg) a 5 (Sex)
                const feriado = window.feriadosCache && window.feriadosCache[iso];
                const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

                if (feriado && feriado.tipo === 'PARCIAL' && isWeekday && def.key === 'atend_14_20') {
                    rawData = rawData.map(item => ({
                        ...item,
                        ref: item.ref || "12h às 18h" // Injeta o horário se não houver referência manual
                    }));
                }
                // --------------------------------------------------

                const isCurrentViewMonth = d.getMonth() === (currentMonth - 1);
                let tdClass = isToday ? 'today-cell' : '';
                if (feriado) tdClass += ' cell-feriado';
                if (!isCurrentViewMonth) tdClass += ' month-fade';

                // Chama a função de desenho passando o def.key (importante para o ícone)
                const displayNames = rawData.map(item =>
                    renderNameWithRef(item, myNorm, normalize, 'my-name-highlight', def.key)
                ).join(' / ');
                
                html += `<td class="${tdClass}">${displayNames || ''}</td>`;
            });
            }
            html += `</tr>`;
        }
    });
    html += `</tbody></table>`;
    return html;
}

// js/escala.js

window.openAbsenceConfigurator = async function(type = 'FOLGA') {
    // 1. Identificação do período visível (ex: "2026-04")
    const monthLabelEl = document.getElementById('escala-month-label');
    const monthYearText = monthLabelEl?.textContent || ""; 
    const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const parts = monthYearText.split(/\s+[Dd]e\s+/);
    const viewMonthIdx = meses.indexOf(parts[0]);
    const viewYear = parts[1];
    const viewedPeriod = `${viewYear}-${String(viewMonthIdx + 1).padStart(2, '0')}`;

    // 2. Filtra a lista de usuários (Apenas Cobrança)
    let allUsers = [];
    try {
        const q = query(collection(db, "users"), where("sectors", "array-contains", "cobranca"));
        const snapshot = await getDocs(q);
        snapshot.forEach(doc => { if (doc.data().Nome) allUsers.push(doc.data().Nome); });
        allUsers.sort();
    } catch (e) { console.error("Erro ao carregar usuários:", e); return; }

    let userDetailsMap = {}; 

    if (type === 'FOLGA') {
        // A. Identifica quais feriados existem neste mês
        const holidayDates = Object.keys(window.feriadosCache || {}).filter(d => d.startsWith(viewedPeriod));
        
        if (holidayDates.length === 0) {
            return Swal.fire("Informação", `Não existem feriados configurados para ${parts[0]}.`, "info");
        }

        // B. Busca quem TRABALHOU nestes feriados específicos
        const qWork = query(collection(db, "escala_individual"), where("data", "in", holidayDates));
        const snapWork = await getDocs(qWork);
        
        snapWork.forEach(doc => {
            const d = doc.data();
            // Verifica se não é uma folga já registrada na linha do feriado
            let isValidWork = !['folga', 'ferias', 'fds_folga'].includes(d.cargoKey);
            if (isValidWork) {
                if (!userDetailsMap[d.nome]) userDetailsMap[d.nome] = { worked: [], taken: 0 };
                userDetailsMap[d.nome].worked.push({ 
                    date: d.data, 
                    reason: window.feriadosCache[d.data].nome 
                });
            }
        });

        // C. Busca folgas tiradas NESTE MÊS que compensam feriados DESTE MÊS
        const qFolgas = query(collection(db, "escala_individual"), 
            where("data", ">=", `${viewedPeriod}-01`), 
            where("data", "<=", `${viewedPeriod}-31`), 
            where("cargoKey", "in", ["folga", "fds_folga"])
        );
        const snapFolgas = await getDocs(qFolgas);
        
        snapFolgas.forEach(doc => {
            const d = doc.data();
            if (userDetailsMap[d.nome]) {
                // SÓ conta como 'taken' se a referência da folga mencionar um dia deste mês
                const isFromThisMonth = holidayDates.some(hDate => {
                    const [y, m, day] = hDate.split('-');
                    return d.referencia && d.referencia.includes(`${day}/${m}`);
                });

                if (isFromThisMonth) {
                    userDetailsMap[d.nome].taken++;
                }
            }
        });
    }

    // 3. Filtra apenas quem tem saldo pendente do mês
    const usersWithBalance = allUsers.filter(u => {
        const short = Object.entries(NAME_MAPPING).find(([k,v]) => v === u)?.[0] || u.split(' ')[0];
        return type === 'FERIAS' || (userDetailsMap[short] && (userDetailsMap[short].worked.length - userDetailsMap[short].taken) > 0);
    });

    if (type === 'FOLGA' && usersWithBalance.length === 0) {
        return Swal.fire("Tudo certo!", `Sem folgas pendentes referentes aos feriados de ${parts[0]}.`, "success");
    }

    // 4. Modal Visual com Flatpickr (Intervalo para Férias / Único para Folga)
    const { value: formValues } = await Swal.fire({
        title: type === 'FOLGA' ? '🏖️ Registrar Folga' : '✈️ Registrar Férias',
        html: `
            <div class="swal-modern-form">
                <div class="swal-input-group">
                    <label class="swal-custom-label">Colaborador</label>
                    <select id="abs-name" class="swal-custom-input">
                        ${usersWithBalance.map(u => `<option value="${u}">${u}</option>`).join('')}
                    </select>
                </div>
                <div id="absence-info-box" style="margin-bottom:15px; padding:10px; background:#f8f9fa; border-radius:8px; font-size:12px; border-left:4px solid #3498db; display:none;"></div>
                <div class="swal-input-group">
                    <label class="swal-custom-label">Data</label>
                    <input type="text" id="abs-start" class="swal-custom-input" placeholder="Selecione a data">
                </div>
            </div>
        `,
        didOpen: () => {
            const nameSelect = document.getElementById('abs-name');
            const infoBox = document.getElementById('absence-info-box');
            
            const updateInfo = () => {
                const fullName = nameSelect.value;
                const short = Object.entries(NAME_MAPPING).find(([k,v]) => v === fullName)?.[0] || fullName.split(' ')[0];
                const data = userDetailsMap[short];
                
                if (type === 'FOLGA' && data) {
                    const balance = data.worked.length - data.taken;
                    const pendingDates = data.worked.slice(data.taken).map(w => `• ${w.date.split('-')[2]}/${w.date.split('-')[1]} (${w.reason})`).join('<br>');
                    infoBox.innerHTML = `<strong>Pendências de ${parts[0]} (${balance}):</strong><br>${pendingDates}`;
                    infoBox.style.display = 'block';
                } else { infoBox.style.display = 'none'; }
            };

            nameSelect.onchange = updateInfo;
            updateInfo();
            flatpickr("#abs-start", { mode: type === 'FERIAS' ? "range" : "single", dateFormat: "Y-m-d", altInput: true, altFormat: "d/m/Y", locale: "pt" });
        },
        preConfirm: () => {
            const fullName = document.getElementById('abs-name').value;
            const short = Object.entries(NAME_MAPPING).find(([k,v]) => v === fullName)?.[0] || fullName.split(' ')[0];
            const data = userDetailsMap[short];
            
            let ref = null;
            if (type === 'FOLGA' && data) {
                // Pega o próximo feriado do mês para compensar
                const holiday = data.worked[data.taken];
                if (holiday) {
                    const [y, m, d] = holiday.date.split('-');
                    ref = `${holiday.reason} no dia ${d}/${m}`; // SALVA COM A DATA
                }
            }

            return { shortName: short, start: document.getElementById('abs-start').value, referencia: ref };
        }
    });

    if (!formValues || !formValues.start) return;

    // 5. Gravação em Batch (Limpando o trabalho anterior)
    let batch = writeBatch(db);
    const dates = formValues.start.split(" até ");
    let cursor = new Date(dates[0] + 'T12:00:00');
    let end = dates[1] ? new Date(dates[1] + 'T12:00:00') : new Date(dates[0] + 'T12:00:00');

    while (cursor <= end) {
        const dateISO = cursor.toISOString().split('T')[0];
        const dayOfWeek = cursor.getDay();
        const targetKey = (dayOfWeek === 0 || dayOfWeek === 6) ? 'fds_folga' : (type === 'FOLGA' ? 'folga' : 'ferias');
        const normName = normalizeText(formValues.shortName).replace(/\s/g, '');

        batch.delete(doc(db, "escala_individual", `${dateISO}_${normName}`));
        batch.set(doc(db, "escala_individual", `${dateISO}_${normName}_${type === 'FOLGA' ? 'folga' : 'ferias'}`), {
            data: dateISO,
            nome: formValues.shortName,
            cargoKey: targetKey,
            referencia: formValues.referencia, // Motivo formatado com data
            updatedAt: serverTimestamp()
        });

        cursor.setDate(cursor.getDate() + 1);
    }

    await batch.commit();
    Swal.fire("Sucesso!", "Registro atualizado.", "success");
    loadEscala();
};

// 1. Abre o modal que lista as férias para exclusão
window.openVacationManager = async function() {
    if(window.showToast) window.showToast("Carregando histórico de férias...", "info");

    try {
        const q = query(collection(db, "ferias_registros"), orderBy("start", "desc"));
        const snapshot = await getDocs(q);
        
        let listHtml = `
            <div style="max-height: 300px; overflow-y: auto; text-align: left; border: 1px solid #eee; border-radius: 8px; padding: 10px;">
        `;

        if (snapshot.empty) {
            listHtml += `<p style="color:#666; text-align:center;">Nenhum registro de férias encontrado.</p>`;
        } else {
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                const id = docSnap.id;
                // Formatação simples para exibição
                const start = data.start.split('-').reverse().join('/');
                const end = data.end.split('-').reverse().join('/');
                
                listHtml += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #f5f5f5;">
                        <div>
                            <strong style="display:block; font-size: 14px;">${data.nome}</strong>
                            <span style="font-size: 12px; color: #666;">${start} até ${end}</span>
                        </div>
                        <button onclick="deleteVacationRecord('${id}', '${data.nome}', '${data.start}', '${data.end}')" 
                                style="background: #ff7675; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;">
                            Excluir
                        </button>
                    </div>
                `;
            });
        }
        listHtml += `</div>`;

        Swal.fire({
            title: '✈️ Gerenciar Férias',
            html: listHtml,
            showConfirmButton: false,
            showCancelButton: true,
            cancelButtonText: 'Fechar'
        });

    } catch (e) {
        console.error("Erro ao listar férias:", e);
        Swal.fire("Erro", "Falha ao carregar registros.", "error");
    }
};

// 2. Função técnica para deletar o registro e limpar a escala
window.deleteVacationRecord = async function(docId, nomeCompleto, startStr, endStr) {
    const result = await Swal.fire({
        title: 'Tem certeza?',
        text: `Deseja remover as férias de ${nomeCompleto}? Os dias na escala ficarão vazios.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Sim, excluir'
    });

    if (!result.isConfirmed) return;

    if(window.showToast) window.showToast("Removendo...", "info");

    try {
        let batch = writeBatch(db);

        // A. Remove o registro mestre
        batch.delete(doc(db, "ferias_registros", docId));

        // B. Identifica o nome curto usado na escala
        let shortName = nomeCompleto.split(' ')[0];
        const entry = Object.entries(NAME_MAPPING).find(([k, v]) => v === nomeCompleto);
        if (entry) shortName = entry[0];

        // C. Limpa os dias na escala individual
        const [startY, startM, startD] = startStr.split('-').map(Number);
        const [endY, endM, endD] = endStr.split('-').map(Number);
        const startDate = new Date(Date.UTC(startY, startM - 1, startD, 12, 0, 0));
        const endDate = new Date(Date.UTC(endY, endM - 1, endD, 12, 0, 0));

        let cursor = new Date(startDate);
        while (cursor <= endDate) {
            const dateISO = cursor.toISOString().split('T')[0];
            const docIdEscala = `${dateISO}_${normalizeText(shortName).replace(/\s/g, '')}_ferias`;
            batch.delete(doc(db, "escala_individual", docIdEscala));
            
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }

        await batch.commit();
        
        Swal.fire('Excluído!', 'O registro de férias foi removido.', 'success');
        
        // Atualiza a visualização
        loadEscala();
        // Reabre o gerenciador para ver a lista atualizada
        window.openVacationManager();

    } catch (e) {
        console.error("Erro ao deletar férias:", e);
        Swal.fire("Erro", "Não foi possível excluir o registro.", "error");
    }
};

window.menuFerias = function() {
    Swal.fire({
        title: 'Opções de Férias',
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Registrar Novas',
        denyButtonText: 'Gerenciar Existentes',
        confirmButtonColor: '#2980b9',
        denyButtonColor: '#8e44ad'
    }).then((result) => {
        if (result.isConfirmed) {
            window.openVacationConfigurator();
        } else if (result.isDenied) {
            window.openVacationManager();
        }
    });
};

function checkHolidayCompOffs() {
    const auditData = {}; 
    const currentMonthNum = currentMonth; 

    cachedEvents.forEach(event => {
        const dateISO = event.data;
        if (!dateISO) return;

        const eventMonth = parseInt(dateISO.split('-')[1]);
        if (eventMonth !== currentMonthNum) return; 

        const name = event.nome;

        if (!auditData[name]) {
            auditData[name] = { worked: [], taken: 0 };
        }

        // 1. Contabiliza Feriados Trabalhados
        if (window.feriadosCache && window.feriadosCache[dateISO]) {
            const dateObj = new Date(dateISO + 'T12:00:00'); 
            const dayOfWeek = dateObj.getDay(); 
            const fullName = Object.entries(NAME_MAPPING).find(([k,v]) => k === name)?.[1] || name;
            const profile = EMPLOYEE_PROFILES[name] || EMPLOYEE_PROFILES[fullName];

            const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
            const isFixedRole = profile && profile.startsWith('FIXO_');

            // Só gera crédito se NÃO for (Fim de Semana + Cargo Fixo)
            if (!(isWeekend && isFixedRole)) {
                if (event.cargoKey !== 'folga' && event.cargoKey !== 'ferias' && event.cargoKey !== 'fds_folga') {
                    auditData[name].worked.push({
                        date: dateISO,
                        reason: window.feriadosCache[dateISO].nome || 'Feriado'
                    });
                }
            }
        }

        // 2. Contabiliza Folgas Tiradas (Abate do Saldo)
        const countsAsTaken = (event.cargoKey === 'folga') || 
                              (event.cargoKey === 'fds_folga' && event.referencia);

        if (countsAsTaken) {
            auditData[name].taken++;
        }
    });

    updateSidebarBadges(auditData);
}

// Função para navegar no modo Leitura
function changeViewMonth(delta) {
    currentMonth += delta;
    
    // Ajusta virada de ano
    if (currentMonth > 12) {
        currentMonth = 1;
        currentYear++;
    } else if (currentMonth < 1) {
        currentMonth = 12;
        currentYear--;
    }

    // Recarrega a visualização com o novo mês
    loadReadOnlyView();
}

window.menuFolga = function() {
    Swal.fire({
        title: 'Opções de Folga',
        html: `
            <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 15px;">
                <button id="btn-folga-auto" class="swal2-confirm swal2-styled" style="background-color: #2980b9; margin: 0;">🏖️ FERIADOS</button>
                <button id="btn-folga-manual" class="swal2-deny swal2-styled" style="background-color: #8e44ad; margin: 0;">📝 MANUAL</button>
                <hr style="margin: 10px 0;">
                <button id="btn-folga-manager" class="swal2-confirm swal2-styled" style="background-color: #2c3e50; margin: 0;">⚙️ Gerenciar Folgas</button>
            </div>
        `,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText: 'Fechar',
        didOpen: () => {
            document.getElementById('btn-folga-auto').onclick = () => { Swal.close(); window.openAbsenceConfigurator('FOLGA'); };
            document.getElementById('btn-folga-manual').onclick = () => { Swal.close(); window.openManualFolga(); };
            document.getElementById('btn-folga-manager').onclick = () => { Swal.close(); window.openFolgaManager(); };
        }
    });
};

window.openFolgaManager = async function() {
    if(window.showToast) window.showToast("Carregando histórico de folgas...", "info");

    try {
        // Busca todas as folgas do ano
        const startYear = `${new Date().getFullYear()}-01-01`;
        const q = query(
            collection(db, "escala_individual"), 
            where("data", ">=", startYear),
            where("cargoKey", "in", ["folga", "fds_folga"]),
            orderBy("data", "desc")
        );
        
        const snapshot = await getDocs(q);
        
        let listHtml = `<div style="max-height: 400px; overflow-y: auto; text-align: left; border: 1px solid #eee; border-radius: 8px; padding: 10px;">`;

        let count = 0;
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            // FILTRO CRÍTICO: Só mostra se tiver referência (Feriado ou Manual)
            if (data.referencia) {
                count++;
                const dataFormatada = data.data.split('-').reverse().join('/');
                listHtml += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #f5f5f5;">
                        <div style="flex: 1;">
                            <strong style="display:block; font-size: 14px;">${data.nome}</strong>
                            <span style="font-size: 12px; color: #c0392b; font-weight: bold;">${data.referencia}</span>
                            <span style="font-size: 11px; color: #666; display: block;">Data da Folga: ${dataFormatada}</span>
                        </div>
                        <button onclick="window.deleteFolgaRecord('${docSnap.id}', '${data.nome}', '${dataFormatada}')" 
                                style="background: #ff7675; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; margin-left: 10px;">
                            Excluir
                        </button>
                    </div>
                `;
            }
        });

        if (count === 0) {
            listHtml += `<p style="color:#666; text-align:center; padding: 20px;">Nenhuma folga com referência encontrada.</p>`;
        }
        
        listHtml += `</div>`;

        Swal.fire({
            title: '⚙️ Gerenciar Folgas',
            html: listHtml,
            showConfirmButton: false,
            showCancelButton: true,
            cancelButtonText: 'Voltar',
            width: '500px'
        });

    } catch (e) {
        console.error("Erro ao gerenciar folgas:", e);
        Swal.fire("Erro", "Não foi possível carregar as folgas.", "error");
    }
};

window.deleteFolgaRecord = async function(docId, nome, dataStr) {
    const confirm = await Swal.fire({
        title: 'Remover Folga?',
        text: `Deseja excluir a folga de ${nome} no dia ${dataStr}?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Sim, excluir'
    });

    if (!confirm.isConfirmed) return;

    try {
        await deleteDoc(doc(db, "escala_individual", docId));
        
        if(window.showToast) window.showToast("Folga removida!", "success");
        
        // Recarrega a escala e o gerenciador para atualizar a lista
        await loadEscala();
        window.openFolgaManager(); 

    } catch (e) {
        console.error("Erro ao excluir folga:", e);
        Swal.fire("Erro", "Falha ao remover registro.", "error");
    }
};

// 2. Modal de Folga Manual
window.openManualFolga = async function() {
    // 1. Busca lista de usuários para o select
    let allUsers = [];
    try {
        const q = query(collection(db, "users"), where("sectors", "array-contains", "cobranca"));
        const snapshot = await getDocs(q);
        snapshot.forEach(doc => { if (doc.data().Nome) allUsers.push(doc.data().Nome); });
        allUsers.sort();
    } catch (e) { console.error(e); return; }

    const usersOptions = allUsers.map(u => `<option value="${u}">${u}</option>`).join('');

    // 2. Interface do Modal
    const { value: formValues } = await Swal.fire({
        title: '📝 Folga Manual',
        html: `
            <div class="swal-modern-form">
                <div class="swal-input-group">
                    <label class="swal-custom-label">Colaborador</label>
                    <select id="man-name" class="swal-custom-input">${usersOptions}</select>
                </div>
                <div class="swal-input-group">
                    <label class="swal-custom-label">Data ou Intervalo</label>
                    <input type="text" id="man-range" class="swal-custom-input" placeholder="Selecione o período">
                </div>
                <div class="swal-input-group">
                    <label class="swal-custom-label">Motivo</label>
                    <select id="man-reason" class="swal-custom-input">
                        <option value="Aniversário">Aniversário</option>
                        <option value="Banco de horas">Banco de horas</option>
                        <option value="Atestado">Atestado</option>
                    </select>
                </div>
            </div>
        `,
        didOpen: () => {
            flatpickr("#man-range", {
                mode: "range",
                dateFormat: "Y-m-d",
                altInput: true,
                altFormat: "d/m/Y",
                locale: "pt"
            });
        },
        preConfirm: () => {
            const fullName = document.getElementById('man-name').value;
            const short = Object.entries(NAME_MAPPING).find(([k,v]) => v === fullName)?.[0] || fullName.split(' ')[0];
            return {
                nome: fullName,
                shortName: short,
                range: document.getElementById('man-range').value,
                motivo: document.getElementById('man-reason').value || "Folga Manual"
            };
        }
    });

    if (!formValues || !formValues.range) return;

    // 3. Processamento das datas (Ajuste de fuso horário)
    const dates = formValues.range.split(" até ");
    let start = new Date(dates[0] + 'T12:00:00');
    let end = dates[1] ? new Date(dates[1] + 'T12:00:00') : new Date(dates[0] + 'T12:00:00');

    let batch = writeBatch(db);
    let cursor = new Date(start);

    // 4. Loop de Gravação e Limpeza
    while (cursor <= end) {
        const dateISO = cursor.toISOString().split('T')[0];
        const dayOfWeek = cursor.getDay(); // 0=Domingo, 6=Sábado
        const normName = normalizeText(formValues.shortName).replace(/\s/g, '');

        // CORREÇÃO 1: Direciona para a linha de FDS se for sábado ou domingo
        const targetKey = (dayOfWeek === 0 || dayOfWeek === 6) ? 'fds_folga' : 'folga';

        // CORREÇÃO 2: Define IDs para deletar o trabalho e criar a folga
        // ID padrão usado na automação (addToBatch)
        const workDocId = `${dateISO}_${normName}`; 
        // ID específico da folga manual para evitar conflitos
        const folgaDocId = `${dateISO}_${normName}_folga`; 

        // REMOVE o registro de trabalho (se existir) para o colaborador sair da linha de horários
        batch.delete(doc(db, ESCALA_INDIVIDUAL_COLLECTION, workDocId));

        // ADICIONA a folga na linha correta com o motivo para a tooltip
        batch.set(doc(db, ESCALA_INDIVIDUAL_COLLECTION, folgaDocId), {
            data: dateISO,
            nome: formValues.shortName,
            cargoKey: targetKey,
            referencia: formValues.motivo, 
            updatedAt: serverTimestamp()
        });

        cursor.setDate(cursor.getDate() + 1);
    }

    await batch.commit();
    Swal.fire("Sucesso!", "Folga(s) registrada(s) e escala atualizada.", "success");
    loadEscala(); // Recarrega o grid visual
};

// js/escala.js

window.openSpecialShiftConfigurator = async function() {
    // 1. Filtra apenas as supervisoras da lista de perfis
    const supervisoras = Object.entries(EMPLOYEE_PROFILES)
        .filter(([name, profile]) => profile.includes('SUPERVISOR'))
        .map(([name]) => name);

    const { value: formValues } = await Swal.fire({
        title: '🕒 Horário Especial / Exceção',
        html: `
            <div class="swal-modern-form">
                <div class="swal-input-group">
                    <label class="swal-custom-label">Supervisora</label>
                    <select id="spec-name" class="swal-custom-input">
                        ${supervisoras.map(s => `<option value="${s}">${s}</option>`).join('')}
                    </select>
                </div>
                <div class="swal-input-group">
                    <label class="swal-custom-label">Data do Ajuste</label>
                    <input type="date" id="spec-date" class="swal-custom-input">
                </div>
                <div class="swal-input-group">
                    <label class="swal-custom-label">Novo Horário (Linha da Tabela)</label>
                    <select id="spec-row" class="swal-custom-input">
                        <option value="atend_08_14">08h às 14h</option>
                        <option value="atend_08_16">08h às 16h</option>
                        <option value="supervisor1">08h às 17h (Sup 1)</option>
                        <option value="supervisor2">11h às 20h (Sup 2)</option>
                        <option value="atend_12_20">12h às 20h</option>
                        <option value="atend_14_20">14h às 20h</option>
                    </select>
                </div>
                <div class="swal-input-group">
                    <label class="swal-custom-label">Motivo (Aparecerá no Tooltip)</label>
                    <input type="text" id="spec-note" class="swal-custom-input" placeholder="Ex: Cobertura de evento / Treinamento">
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Aplicar Mudança',
        preConfirm: () => {
            const rowSelect = document.getElementById('spec-row');
            const horarioTexto = rowSelect.options[rowSelect.selectedIndex].text;
            const motivo = document.getElementById('spec-note').value;

            return {
                nome: document.getElementById('spec-name').value,
                data: document.getElementById('spec-date').value,
                cargoKey: rowSelect.value,
                // Salva apenas o novo horário e o motivo (Ex: "08h às 14h - Treinamento")
                referencia: `${horarioTexto}${motivo ? ' - ' + motivo : ''}`
            }
        }
    });

    if (!formValues || !formValues.data) return;

    try {
        let batch = writeBatch(db);
        const normName = normalizeText(formValues.nome).replace(/\s/g, '');
        const dateISO = formValues.data;

        // 1. Limpa o horário padrão dela naquele dia para não duplicar
        const workDocId = `${dateISO}_${normName}`;
        batch.delete(doc(db, ESCALA_INDIVIDUAL_COLLECTION, workDocId));

        // 2. Salva o novo horário com a referência (Tooltip)
        // Usamos um ID que identifica que é uma troca de horário
        const specialDocId = `${dateISO}_${normName}_troca`;
        
        batch.set(doc(db, ESCALA_INDIVIDUAL_COLLECTION, specialDocId), {
            data: dateISO,
            nome: formValues.nome,
            cargoKey: formValues.cargoKey,
            referencia: formValues.nota, // O segredo do tooltip está aqui
            updatedAt: serverTimestamp()
        });

        await batch.commit();
        Swal.fire("Sucesso!", "Horário especial configurado com tooltip.", "success");
        loadEscala(); // Recarrega o grid
    } catch (e) {
        console.error(e);
        Swal.fire("Erro", "Não foi possível salvar a alteração.", "error");
    }
};

// =========================================================
// EXPORTAÇÕES GLOBAIS
// =========================================================
window.initEscala = initEscala;
window.changeEscalaMonth = changeEscalaMonth;
window.saveManualEdit = saveManualEdit;
window.autoFillCycle = autoFillCycle;
window.openCycleConfigurator = openCycleConfigurator;
window.openVacationConfigurator = openVacationConfigurator;
window.loadReadOnlyView = loadReadOnlyView;
window.changeViewMonth = changeViewMonth;
window.openVacationConfigurator = () => window.openAbsenceConfigurator('FERIAS');
window.openFolgaConfigurator = window.menuFolga;
window.menuFerias = menuFerias;
window.openManualFolga = openManualFolga;
window.openFolgaManager = openFolgaManager;
window.openSpecialShiftConfigurator = openSpecialShiftConfigurator;