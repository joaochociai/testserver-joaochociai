// js/escala.js
import { db, auth } from './firebase.js';
import { 
    doc, updateDoc, getDoc, setDoc, deleteDoc, getDocs, collection, query, where, writeBatch, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getCycleStage, ESCALA_CYCLE, NAME_MAPPING, normalizeText } from "./utils.js";

const ESCALA_INDIVIDUAL_COLLECTION = "escala_individual"; // Nova coleção
const SETTINGS_COLLECTION = "config_geral"; 
const TEAM_DOC_ID = "equipe_cobranca";      

// Estado local
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1; // 1-12
let employeeList = []; 
let cachedEvents = []; // Armazena os dados individuais carregados

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

// ------------------------------------------------------------------
// 2. INICIALIZAÇÃO E CARREGAMENTO
// ------------------------------------------------------------------

export function initEscala() {
    renderMonthLabel();
    loadEmployeeList();
    loadEscala(); // Carrega dados e renderiza
    
    // Bind navigation buttons
    const prev = document.getElementById('prev-month');
    if(prev) prev.onclick = () => changeEscalaMonth(-1);
    const next = document.getElementById('next-month');
    if(next) next.onclick = () => changeEscalaMonth(1);
}

function renderMonthLabel() {
    const date = new Date(currentYear, currentMonth - 1, 1);
    const name = date.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    const label = document.getElementById('escala-month-label');
    if(label) label.textContent = name.charAt(0).toUpperCase() + name.slice(1);
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
        
    } catch (err) {
        console.error("Erro loading:", err);
    }
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
            const dayOfWeek = currentObj.getDay(); // 6=Sábado, 0=Domingo

            if (dayOfWeek === 6) { // É Sábado
                // Verifica se essa mesma pessoa tem folga no Domingo (dia seguinte)
                const nextDay = new Date(y, m - 1, d + 1);
                const nextDayISO = nextDay.toISOString().split('T')[0];
                
                const hasSundayOff = cachedEvents.some(e => 
                    e.nome === record.nome && 
                    e.data === nextDayISO && 
                    e.cargoKey === 'fds_folga'
                );

                if (!hasSundayOff) shouldRender = false; // Se trabalha domingo, esconde a folga de sábado

            } else if (dayOfWeek === 0) { // É Domingo
                // Verifica se essa mesma pessoa teve folga no Sábado (dia anterior)
                const prevDay = new Date(y, m - 1, d - 1);
                const prevDayISO = prevDay.toISOString().split('T')[0];

                const hasSaturdayOff = cachedEvents.some(e => 
                    e.nome === record.nome && 
                    e.data === prevDayISO && 
                    e.cargoKey === 'fds_folga'
                );

                if (!hasSaturdayOff) shouldRender = false; // Se trabalhou sábado, esconde a folga de domingo
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
    let html = `<table class="escala-table ${isWeekend ? 'weekend-table' : ''}"><thead><tr>
        <th class="${isWeekend ? 'col-horario-fds' : 'col-cargo'}">${isWeekend ? 'HORÁRIO' : 'CARGO'}</th>
        ${!isWeekend ? '<th class="col-horario">HORÁRIO</th>' : ''}`;
    
    dates.forEach(d => {
        const dayName = d.toLocaleDateString('pt-BR', { weekday: 'short' }).toUpperCase().slice(0, 3);
        const isToday = d.toDateString() === new Date().toDateString();
        html += `<th class="${isToday ? 'today-header' : ''}">${dayName}<br><small>${d.getDate()}/${d.getMonth()+1}</small></th>`;
    });
    html += `</tr></thead><tbody>`;

    rows.forEach(def => {
        if (def.type === 'header') {
            html += `<tr class="${def.cssClass}"><td colspan="${dates.length + 2}">${def.label}</td></tr>`;
        } else {
            html += `<tr class="${def.cssClass}">
                <td class="${isWeekend ? 'time-cell-fds' : 'cargo-cell'}">${def.label}</td>
                ${!isWeekend ? `<td class="time-cell">${def.time}</td>` : ''}`;
            
            // --- MODIFICAÇÃO AQUI: CÉLULA UNIFICADA PARA FOLGA FDS ---
            if (isWeekend && def.key === 'fds_folga') {
                // Pega a data do Sábado (primeiro item do array dates)
                const d = dates[0]; 
                const y = d.getFullYear();
                const m = d.getMonth() + 1;
                const _d = d.getDate();

                // Cria UMA célula com colspan="2" (ocupa Sábado e Domingo)
                // Usamos os dados do Sábado como referência para salvar
                html += `<td colspan="${dates.length}" style="text-align: center; vertical-align: middle; background-color: #fff5f5;">
                    <textarea class="escala-input" rows="1" 
                        style="text-align: center; font-weight: bold; color: #c0392b;"
                        data-day="${_d}" data-month="${m}" data-year="${y}" data-row="${def.key}"
                        onblur="window.saveManualEdit(this)"
                        oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
                </td>`;
            } 
            // --- CÉLULAS NORMAIS (DIAS ÚTEIS OU OUTROS HORÁRIOS DO FDS) ---
            else {
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
        html: `Início: <b>01/${currentMonth}/${currentYear}</b><br><br>
               <b>Regras de Feriado Aplicadas:</b><br>
               🚫 Elaine e João: Folga Total<br>
               ⚡ Atendentes: Apenas Turno 6h (Roda)<br>
               👑 Supervisão: Apenas 1 por Feriado (Roda)`,
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

        // 3. Inicializa Batch
        let batch = writeBatch(db); 
        let operationCount = 0;
        
        // --- FUNÇÕES AUXILIARES ---
        function addToBatch(date, name, key, isFeriado, needsCompensacao = false) {
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
    if (currentMonth > 12) { currentMonth = 1; currentYear++; }
    else if (currentMonth < 1) { currentMonth = 12; currentYear--; }
    renderMonthLabel();
    loadEscala();
}

async function loadEmployeeList() {
    // 1. Seleciona o container (ajuste o seletor se necessário)
    const listContainer = document.querySelector('.equipe-list-container') || document.getElementById('employees-list') || document.getElementById('external-events');
    
    if(!listContainer) return;

    // Feedback visual
    listContainer.innerHTML = '<div style="padding:10px; color:#666; text-align:center;">Carregando equipe...</div>';

    try {
        // 2. Busca Usuários
        const q = query(collection(db, "users")); 
        const querySnapshot = await getDocs(q);
        
        let fullEmployeeData = []; // Lista temporária com objetos completos
        
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            // Só adiciona se tiver Nome
            if (data.Nome && data.Nome.trim() !== "") {
                fullEmployeeData.push({
                    id: doc.id,          // Importante para o botão Editar
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
            listContainer.innerHTML = '<div style="padding:10px; color:#999;">Nenhum funcionário encontrado.</div>';
            return;
        }

        fullEmployeeData.forEach(user => {
            // Cria o elemento do Card
            const card = document.createElement('div');
            card.className = 'employee-card'; // Classe do CSS que te mandei antes
            card.setAttribute('draggable', 'true');
            
            // Monta o HTML interno (Nome, Cargo, Email, Botão Editar)
            card.innerHTML = `
                <div class="card-name">${user.Nome}</div>
                <div class="card-detail"> ${user.Email || '-'}</div>
                <button class="edit-btn" onclick="openUserEditor('${user.id}')" title="Editar">✎</button>
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

window.openUserEditor = async function(userId) {
    const docRef = doc(db, "users", userId);
    
    // Mostra carregando...
    Swal.showLoading();
    const docSnap = await getDoc(docRef);
    Swal.close();
    
    if (!docSnap.exists()) return;
    const data = docSnap.data();

    const { value: formValues } = await Swal.fire({
        title: '✏️ Editar Funcionário',
        html: `
            <label style="display:block; text-align:left; font-size:12px; margin-top:10px;">Nome Completo</label>
            <input id="swal-nome" class="swal2-input" value="${data.Nome || ''}">
            
            <label style="display:block; text-align:left; font-size:12px; margin-top:10px;">Email</label>
            <input id="swal-email" class="swal2-input" value="${data.Email || ''}">
            
            <label style="display:block; text-align:left; font-size:12px; margin-top:10px;">Setor</label>
            <input id="swal-setor" class="swal2-input" value="${data.Setor || ''}">
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Salvar',
        preConfirm: () => {
            return {
                Nome: document.getElementById('swal-nome').value,
                Email: document.getElementById('swal-email').value,
                Cargo: document.getElementById('swal-cargo').value,
                Setor: document.getElementById('swal-setor').value
            }
        }
    });

    if (formValues) {
        await updateDoc(docRef, formValues);
        Swal.fire('Salvo!', 'Dados atualizados.', 'success');
        loadEmployeeList(); // Recarrega a lista para mostrar as mudanças
    }
};

// ------------------------------------------------------------------
// RENDERIZAR BARRA LATERAL (Drag & Drop)
// ------------------------------------------------------------------
function renderEmployeeSidebar(container) {
    container.innerHTML = ""; // Limpa lista atual

    if (employeeList.length === 0) {
        container.innerHTML = '<div style="padding:10px; font-size:12px;">Nenhum usuário encontrado.</div>';
        return;
    }

    employeeList.forEach(name => {
        // Cria o elemento visual ("Chip" ou "Etiqueta")
        const chip = document.createElement("div");
        
        // Estilização básica caso não tenha CSS (pode ajustar no style.css)
        chip.className = "employee-chip"; 
        chip.style.padding = "8px 12px";
        chip.style.margin = "5px 0";
        chip.style.backgroundColor = "white";
        chip.style.border = "1px solid #ddd";
        chip.style.borderRadius = "4px";
        chip.style.cursor = "grab";
        chip.style.fontSize = "14px";
        chip.style.boxShadow = "0 1px 2px rgba(0,0,0,0.05)";
        
        chip.innerText = name;
        chip.draggable = true; // Permite arrastar

        // Configura o evento de Arrastar (Drag)
        chip.ondragstart = (ev) => {
            ev.dataTransfer.setData("text/plain", name);
            ev.dataTransfer.effectAllowed = "copy";
            chip.style.opacity = "0.5"; // Feedback visual
        };

        chip.ondragend = () => {
            chip.style.opacity = "1";
        };

        container.appendChild(chip);
    });
}

// =========================================================
// 6. CONTROLE DE INTERFACE (ABRIR/FECHAR EDITOR)
// =========================================================

window.openEscalaEditor = async function () {
    const viewContainer = document.getElementById("escala-view-container");
    const editorWrapper = document.getElementById("escala-editor-wrapper");
    const editBtn = document.getElementById("btn-open-editor");

    // Esconde a visualização de leitura e mostra o editor
    if (viewContainer) viewContainer.style.display = "none";
    if (editBtn) editBtn.style.display = "none";
    if (editorWrapper) {
        editorWrapper.style.display = "block";
        // Garante que os dados estejam carregados e renderizados no editor
        // Chamamos a função de renderização apontando para o ID do container do editor
        await loadEscala(); 
    }
};

window.closeEscalaEditor = function () {
    const viewContainer = document.getElementById("escala-view-container");
    const editorWrapper = document.getElementById("escala-editor-wrapper");
    const editBtn = document.getElementById("btn-open-editor");

    // Volta para o modo visualização
    if (editorWrapper) editorWrapper.style.display = "none";
    if (viewContainer) viewContainer.style.display = "block";
    if (editBtn) editBtn.style.display = "inline-block";
    
    // Recarrega a escala para atualizar a visualização de leitura (se houver lógica para ela)
    // No modelo novo, talvez você queira renderizar a leitura aqui também.
    // Por enquanto, apenas fechar resolve.
};

// =========================================================
// 7. CONFIGURADOR DE CICLOS (ECONÔMICO DE QUOTA)
// =========================================================

window.openCycleConfigurator = async function() {
    // 1. Carrega lista de funcionários para o Select (Leitura Otimizada)
    if(window.showToast) window.showToast("Carregando equipe...", "info");
    
    let usersOptions = "";
    try {
        const q = query(collection(db, "users"));
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
        const q = query(collection(db, "users"));
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

async function loadReadOnlyView() {
    const container = document.getElementById('escala-view-content') || document.getElementById('conteudo-escala');
    if(!container) return;

    // Loader simples
    container.innerHTML = '<div class="loader" style="text-align:center; padding:20px;">Carregando escala...</div>';

    try {
        const year = currentYear;
        const monthIndex = currentMonth - 1;

        // --- 1. DEFINE DATAS ---
        const firstDay = new Date(year, monthIndex, 1);
        const startOffset = firstDay.getDay() === 0 ? -6 : 1 - firstDay.getDay();
        const startDate = new Date(year, monthIndex, 1 + startOffset);
        
        const lastDay = new Date(year, monthIndex + 1, 0);
        const endOffset = lastDay.getDay() === 0 ? 0 : 7 - lastDay.getDay();
        const endDate = new Date(year, monthIndex + 1, 0 + endOffset);

        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        // --- 2. DESCOBRE USUÁRIO (Para o Negrito) ---
        let myShortName = null;
        if (auth.currentUser) {
            const qUser = query(collection(db, "users"), where("Email", "==", auth.currentUser.email));
            const snapUser = await getDocs(qUser);
            if (!snapUser.empty) {
                const fullName = snapUser.docs[0].data().Nome;
                const entry = Object.entries(NAME_MAPPING).find(([key, value]) => value === fullName);
                myShortName = entry ? entry[0] : fullName.split(' ')[0];
            }
        }

        // --- 3. BUSCA DADOS ---
        const q = query(
            collection(db, "escala_individual"), 
            where("data", ">=", startStr),
            where("data", "<=", endStr)
        );
        const snapshot = await getDocs(q);
        const events = [];
        snapshot.forEach(doc => events.push(doc.data()));

        // --- 4. RENDERIZAÇÃO (AGORA COM BOTÕES) ---
        
        // Limpa o container
        container.innerHTML = "";

        // A. Desenha o Cabeçalho de Navegação
        const monthName = new Date(year, monthIndex, 1).toLocaleDateString('pt-BR', { month: 'long' });
        const monthCapitalized = monthName.charAt(0).toUpperCase() + monthName.slice(1);

        const navDiv = document.createElement("div");
        navDiv.style.display = "flex";
        navDiv.style.alignItems = "center";
        navDiv.style.justifyContent = "center"; // Centralizado
        navDiv.style.gap = "20px";
        navDiv.style.marginBottom = "30px";
        navDiv.style.padding = "15px";
        navDiv.style.backgroundColor = "#fff";
        navDiv.style.borderRadius = "8px";
        navDiv.style.boxShadow = "0 2px 4px rgba(0,0,0,0.05)";

        navDiv.innerHTML = `
            <button onclick="window.changeViewMonth(-1)" style="
                background: #f1f2f6; border: none; padding: 8px 15px; 
                border-radius: 5px; cursor: pointer; font-size: 18px; color: #555;
                transition: background 0.2s;">
                ◀
            </button>
            
            <h2 style="margin: 0; color: #2c3e50; font-size: 24px;">
                ${monthCapitalized} de ${year}
            </h2>

            <button onclick="window.changeViewMonth(1)" style="
                background: #f1f2f6; border: none; padding: 8px 15px; 
                border-radius: 5px; cursor: pointer; font-size: 18px; color: #555;
                transition: background 0.2s;">
                ▶
            </button>
        `;
        container.appendChild(navDiv);

        // B. Cria uma div para as tabelas e chama a função de renderizar
        const tablesContainer = document.createElement("div");
        renderReadOnlyTable(tablesContainer, startDate, endDate, events, myShortName);
        container.appendChild(tablesContainer);

    } catch (err) {
        console.error("Erro view:", err);
        container.innerHTML = '<div style="color:red; text-align:center;">Erro ao carregar escala.</div>';
    }
}

function renderReadOnlyTable(container, startDate, endDate, events, myShortName) {
    container.innerHTML = ""; 
    let loopDate = new Date(startDate);
    
    // Agrupamento
    const dataMap = {};
    events.forEach(e => {
        const key = `${e.data}_${e.cargoKey}`;
        if(!dataMap[key]) dataMap[key] = [];
        if(!dataMap[key].includes(e.nome)) dataMap[key].push(e.nome);
    });

    // Loop Semanal
    while (loopDate <= endDate) {
        const weekDates = [];
        for(let i=0; i<7; i++) {
            weekDates.push(new Date(loopDate));
            loopDate.setDate(loopDate.getDate() + 1);
        }
        const monday = weekDates[0];
        const sunday = weekDates[6];

        const wrapper = document.createElement("div");
        wrapper.className = "week-wrapper-readonly";
        wrapper.style.marginBottom = "30px";
        wrapper.style.backgroundColor = "#fff";
        wrapper.style.borderRadius = "8px";
        wrapper.style.boxShadow = "0 2px 5px rgba(0,0,0,0.05)";
        wrapper.style.padding = "15px";

        // Título formatado
        const f = (d) => `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}`;
        wrapper.innerHTML = `
            <div style="padding: 10px 15px; background: #f1f2f6; border-left: 5px solid #2980b9; color: #2c3e50; font-weight: bold; font-size: 16px; margin-bottom: 15px; border-radius: 4px;">
                📅 Semana de ${f(monday)} a ${f(sunday)}
            </div>
        `;

        const tablesRow = document.createElement("div");
        tablesRow.style.display = "flex";
        tablesRow.style.flexDirection = "row";
        tablesRow.style.alignItems = "flex-start";
        tablesRow.style.gap = "20px";
        tablesRow.style.overflowX = "auto";

        // --- AQUI A MÁGICA: Passamos 'myShortName' para o gerador ---
        const htmlWeek = generateStaticHTML(weekDates.slice(0, 5), WEEKDAY_ROWS, false, dataMap, myShortName);
        const htmlFds = generateStaticHTML(weekDates.slice(5, 7), WEEKEND_ROWS, true, dataMap, myShortName);

        const divWeek = document.createElement("div");
        divWeek.style.flex = "3";
        divWeek.style.minWidth = "600px";
        divWeek.innerHTML = htmlWeek;

        const divFds = document.createElement("div");
        divFds.style.flex = "1";
        divFds.style.minWidth = "250px"; 
        divFds.innerHTML = htmlFds;

        tablesRow.appendChild(divWeek);
        tablesRow.appendChild(divFds);
        wrapper.appendChild(tablesRow);
        container.appendChild(wrapper);
    }
}

// =========================================================
// 10. CONFIGURADOR DE FERIADOS (JANELA DE GERENCIAMENTO)
// =========================================================

// Função principal que abre a janela
window.openHolidayConfigurator = async function() {
    
    // 1. LOADING: Mostra carregando enquanto busca no banco
    const tempPopup = Swal.fire({ title: 'Carregando feriados...', didOpen: () => Swal.showLoading() });

    try {
        // 2. BUSCA FERIADOS EXISTENTES
        // Ordena por ID (que é a data) para ficar organizado
        const q = query(collection(db, "feriados_config")); 
        const snapshot = await getDocs(q);
        
        // 3. MONTA A LISTA HTML
        let htmlList = '<div style="max-height:250px; overflow-y:auto; text-align:left; border:1px solid #eee; padding:5px; margin-bottom:15px; border-radius:4px;">';
        
        if (snapshot.empty) {
            htmlList += '<p style="text-align:center; color:#999; margin:10px;">Nenhum feriado cadastrado.</p>';
        } else {
            // Converte para array para poder ordenar por data antes de exibir
            let feriados = [];
            snapshot.forEach(doc => feriados.push({ id: doc.id, ...doc.data() }));
            
            // Ordena visualmente
            feriados.sort((a, b) => a.id.localeCompare(b.id));

            feriados.forEach(item => {
                // Formata data: 2025-12-25 -> 25/12/2025
                const dataFormatada = item.id.split('-').reverse().join('/');
                
                // Define ícone e cor
                const isTotal = item.tipo === 'TOTAL';
                const icon = isTotal ? '🔴' : '🟡';
                const label = isTotal ? 'Folga Geral' : 'Revezamento';

                htmlList += `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid #f1f1f1;">
                        <div>
                            <strong>${dataFormatada}</strong> - ${item.nome} <br>
                            <small style="color:${isTotal ? '#c0392b' : '#f39c12'}">${icon} ${label}</small>
                        </div>
                        <button onclick="window.deleteHoliday('${item.id}')" style="border:none; background:none; cursor:pointer; font-size:16px;" title="Excluir">
                            🗑️
                        </button>
                    </div>
                `;
            });
        }
        htmlList += '</div>';

        // Fecha o loading
        tempPopup.close();

        // 4. ABRE O MODAL COM A LISTA + FORMULÁRIO DE CADASTRO
        const { value: formValues } = await Swal.fire({
            title: '📅 Gerenciar Feriados',
            html: `
                ${htmlList}
                <h3 style="font-size:16px; margin:10px 0; text-align:left;">Adicionar Novo:</h3>
                <input type="date" id="fer-date" class="swal2-input" style="margin:5px 0; width:100%;">
                <input type="text" id="fer-name" class="swal2-input" placeholder="Nome do Feriado (ex: Natal)" style="margin:5px 0; width:100%;">
                <select id="fer-type" class="swal2-input" style="margin:5px 0; width:100%;">
                    <option value="REVEZAMENTO">🟡 Revezamento (Roda a Equipe)</option>
                    <option value="TOTAL">🔴 Folga Total (Ninguém Trabalha)</option>
                </select>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Salvar Feriado',
            cancelButtonText: 'Fechar',
            preConfirm: () => {
                const data = document.getElementById('fer-date').value;
                const nome = document.getElementById('fer-name').value;
                const tipo = document.getElementById('fer-type').value;

                if (!data || !nome) {
                    Swal.showValidationMessage('Preencha a data e o nome!');
                    return false;
                }
                return { data, nome, tipo };
            }
        });

        // 5. SALVA NO BANCO SE O USUÁRIO CLICOU EM SALVAR
        if (formValues) {
            // Usa a DATA como ID do documento (evita duplicatas no mesmo dia)
            await setDoc(doc(db, "feriados_config", formValues.data), {
                nome: formValues.nome,
                tipo: formValues.tipo,
                data: formValues.data // redundante mas útil
            });

            // Atualiza cache global (para a tabela pintar de laranja sem F5)
            if (!window.feriadosCache) window.feriadosCache = {};
            window.feriadosCache[formValues.data] = formValues;

            Swal.fire({
                title: "Salvo!",
                text: "Feriado adicionado com sucesso.",
                icon: "success",
                timer: 1500,
                showConfirmButton: false
            });

            // Reabre a janela para ver a lista atualizada
            setTimeout(() => window.openHolidayConfigurator(), 800);
        }

    } catch (error) {
        console.error("Erro feriados:", error);
        Swal.fire("Erro", "Não foi possível carregar os feriados.", "error");
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
    // Helper para normalizar texto
    const normalize = (str) => {
        return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() : "";
    };
    const myNorm = normalize(myShortName);

    let html = `<table class="escala-table ${isWeekend ? 'weekend-table' : ''}">
        <thead><tr>
            <th class="${isWeekend ? 'col-horario-fds' : 'col-cargo'}">${isWeekend ? 'HORÁRIO' : 'CARGO'}</th>
            ${!isWeekend ? '<th class="col-horario">HORÁRIO</th>' : ''}`;
    
    // --- CABEÇALHO (DIAS) ---
    dates.forEach(d => {
        const dayName = d.toLocaleDateString('pt-BR', { weekday: 'short' }).toUpperCase().slice(0, 3);
        const isToday = d.toDateString() === new Date().toDateString();
        
        // Verifica se o dia pertence ao mês atual da visualização
        const isCurrentViewMonth = d.getMonth() === (currentMonth - 1);

        // Estilo: Se não for do mês, fica transparente
        const fadeStyle = isCurrentViewMonth ? '' : 'opacity: 0.25; filter: grayscale(100%);';

        // Estilo: Hoje (Amarelo)
        const thHighlight = isToday 
            ? 'background-color: #fff9c4; color: #2c3e50; border-bottom: 3px solid #f1c40f;' 
            : '';

        // Estilo: Feriado no Cabeçalho (Opcional, mas ajuda)
        const isoHeader = d.toISOString().split('T')[0];
        const isFeriadoHeader = window.feriadosCache && window.feriadosCache[isoHeader];
        const feriadoHeaderStyle = isFeriadoHeader ? 'color: #e65100; font-weight:bold;' : '';

        html += `<th style="${thHighlight} ${fadeStyle} ${feriadoHeaderStyle}">
            ${dayName}<br>
            <small>${d.getDate()}/${d.getMonth()+1}</small>
        </th>`;
    });
    html += `</tr></thead><tbody>`;

    // --- CORPO DA TABELA ---
    rows.forEach(def => {
        if (def.type === 'header') {
            html += `<tr class="${def.cssClass}"><td colspan="${dates.length + 2}"><b>${def.label}</b></td></tr>`;
        } else {
            html += `<tr class="${def.cssClass}">
                <td class="${isWeekend ? 'time-cell-fds' : 'cargo-cell'}">${def.label}</td>
                ${!isWeekend ? `<td class="time-cell">${def.time}</td>` : ''}`;
            
            // --- CÉLULA FOLGA FDS (UNIFICADA) ---
            if (isWeekend && def.key === 'fds_folga') {
                const sat = dates[0];
                const sun = dates[1];
                
                const showWeekend = (sat.getMonth() === currentMonth - 1) || (sun.getMonth() === currentMonth - 1);
                const fadeStyle = showWeekend ? '' : 'opacity: 0.25;';

                const satISO = sat.toISOString().split('T')[0];
                const sunISO = sun.toISOString().split('T')[0];
                const satNames = dataMap[`${satISO}_fds_folga`] || [];
                const sunNames = dataMap[`${sunISO}_fds_folga`] || [];
                
                const fullWeekendOff = satNames.filter(name => sunNames.includes(name));
                
                const formattedNames = fullWeekendOff.map(name => {
                    if (myNorm && normalize(name) === myNorm) {
                        return `<span style="font-weight:900; color:#c0392b; text-decoration:underline; font-size:1.1em;">${name}</span>`;
                    }
                    return name;
                }).join(' / ');

                html += `<td colspan="2" style="text-align:center; vertical-align:middle; background-color:#fff5f5; color:#c0392b; font-weight:bold; height:30px; ${fadeStyle}">
                    ${formattedNames}
                </td>`;
            } 
            // --- CÉLULAS NORMAIS ---
            else {
                dates.forEach(d => {
                    const iso = d.toISOString().split('T')[0];
                    const key = `${iso}_${def.key}`;
                    const rawNames = dataMap[key] || [];

                    const isToday = d.toDateString() === new Date().toDateString();
                    const isCurrentViewMonth = d.getMonth() === (currentMonth - 1);

                    // 1. ESTILO BÁSICO (Transparência mês / Hoje)
                    const fadeStyle = isCurrentViewMonth ? '' : 'opacity: 0.25;';
                    let cellStyle = isToday ? 'background-color: #fff9c4; color: #000;' : '';

                    // 2. VERIFICAÇÃO DE FERIADO (NOVO)
                    // (Esta lógica tem que vir ANTES de usar a variável html)
                    let feriadoClass = '';
                    if (window.feriadosCache && window.feriadosCache[iso]) {
                        feriadoClass = 'cell-feriado'; // Adiciona a classe CSS laranja
                        // Se quiser forçar style inline:
                        // cellStyle = 'background-color: #ffe0b2; color: #e65100; font-weight: bold;';
                    }

                    // 3. PREPARA OS NOMES (AQUI CRIA O displayNames)
                    const displayNames = rawNames.map(name => {
                        if (myNorm && normalize(name) === myNorm) {
                            return `<span style="font-weight:900; color:#000; background-color:rgba(255,255,255,0.7); padding:2px 6px; border-radius:4px; border:1px solid #666; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">${name}</span>`;
                        }
                        return name;
                    }).join(' / ');
                    
                    // 4. MONTA O HTML FINAL DA CÉLULA
                    html += `<td class="${feriadoClass}" style="text-align:center; height:30px; vertical-align:middle; ${cellStyle} ${fadeStyle}">
                        ${displayNames}
                    </td>`;
                });
            }
            html += `</tr>`;
        }
    });
    html += `</tbody></table>`;
    return html;
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