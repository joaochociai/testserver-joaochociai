// js/dashboard_juridico.js
import { db } from "./firebase.js";
import { collection, doc, setDoc, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { Chart, registerables } from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/+esm';
import ChartDataLabels from 'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/+esm';

// 1. REGISTRO OBRIGATÓRIO (Garante que o plugin exista)
Chart.register(...registerables, ChartDataLabels);

const DASH_COLLECTION = "dashboard_juridico";

let chartFunil = null;
let chartRecup = null;
let chartHist = null;
let chartAnual = null;

// --- CONFIGURAÇÃO DE RÓTULOS (A SOLUÇÃO DEFINITIVA) ---
// Isso força o rótulo a ficar NO TOPO e CENTRALIZADO na coluna
const FORCE_LABELS = {
    display: true,
    anchor: 'end',      // Fixa na ponta final da barra
    align: 'end',       // Empurra para fora da barra (pra cima)
    offset: -5,         // Pequeno ajuste para não colar na borda
    color: '#444',      // Cor escura para contraste
    textAlign: 'center',
    font: { 
        weight: 'bold', 
        size: 11, 
        family: 'Arial' 
    },
    clip: false,        // PERMITE que o rótulo saia do gráfico se precisar
    clamp: false        // Não tenta forçar o rótulo para dentro
};

// ======================================================
// 0. INICIALIZAÇÃO
// ======================================================
export function initJuridicoDashboard() {
    fixHtmlStructure(); 
    initJuridicoListeners();
    loadJuridicoDashboard();
}

function fixHtmlStructure() {
    const ids = ['chart-jur-funil', 'chart-jur-recuperacao', 'chart-jur-historico', 'chart-jur-anual'];
    ids.forEach(id => {
        const canvas = document.getElementById(id);
        if (canvas) {
            // Limpa estilos inline que possam atrapalhar
            canvas.style.cssText = "width: 100%; height: 100%;";
            
            const parent = canvas.parentElement;
            if (!parent.classList.contains('chart-canvas-wrapper')) {
                const wrapper = document.createElement('div');
                wrapper.className = 'chart-canvas-wrapper';
                parent.replaceChild(wrapper, canvas);
                wrapper.appendChild(canvas);
            }
        }
    });
}

function initJuridicoListeners() {
    const startInput = document.getElementById('dash-jur-start');
    const endInput = document.getElementById('dash-jur-end');
    if(startInput) startInput.onchange = () => loadJuridicoDashboard();
    if(endInput) endInput.onchange = () => loadJuridicoDashboard();
}

// ======================================================
// 1. IMPORTAÇÃO
// ======================================================
export function openImportDashJuridico() {
    document.getElementById('modal-import-dash-juridico').classList.remove('modal-hidden');
}

export async function processImportDashJuridico() {
    const text = document.getElementById('import-dash-juridico-text').value;
    if (!text) return Swal.fire('Ops', 'Cole os dados primeiro.', 'warning');

    const lines = text.trim().split('\n');
    let count = 0;
    const cleanMoney = (val) => (!val ? 0 : parseFloat(val.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0);
    const cleanInt = (val) => parseInt(val?.replace(/\./g, '').trim()) || 0;

    Swal.fire({ title: 'Importando...', didOpen: () => Swal.showLoading() });

    try {
        const batchPromises = lines.map(async (line) => {
            const cols = line.split('\t');
            if (cols.length < 2) return;
            const rawDate = cols[0].trim();
            const parts = rawDate.split('/');
            if(parts.length !== 3) return; 
            const isoDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
            
            const docData = {
                date: isoDate, displayDate: rawDate,
                disparos: cleanInt(cols[1]), debitos: cleanMoney(cols[2]),
                interacoes: cleanInt(cols[3]), negociacoesInfo: cleanInt(cols[4]),
                acordosInfo: cleanInt(cols[5]), pagamentos: cleanMoney(cols[6]),
                negociacoesEmail: cleanInt(cols[7]), acordosEmail: cleanInt(cols[8]),
                cancelamentos: cleanInt(cols[9]), receitaPerdida: cleanMoney(cols[10]),
                termos: cleanInt(cols[11])
            };
            await setDoc(doc(db, DASH_COLLECTION, isoDate), docData);
            count++;
        });
        await Promise.all(batchPromises);
        document.getElementById('modal-import-dash-juridico').classList.add('modal-hidden');
        Swal.fire('Sucesso!', `${count} registros importados.`, 'success');
        loadJuridicoDashboard();
    } catch (error) {
        console.error(error); Swal.fire('Erro', 'Falha na importação.', 'error');
    }
}

// ======================================================
// 2. CARREGAMENTO DE DADOS
// ======================================================
export async function loadJuridicoDashboard() {
    fixHtmlStructure(); 
    
    const startInput = document.getElementById('dash-jur-start');
    const endInput = document.getElementById('dash-jur-end');

    if (!startInput || !endInput) return;

    if (!startInput.value || !endInput.value) {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        startInput.value = firstDay; endInput.value = lastDay;
        if(startInput.value) return loadJuridicoDashboard();
    }

    try {
        const q = query(collection(db, DASH_COLLECTION), orderBy("date", "asc"));
        const snapshot = await getDocs(q);
        const allData = [];
        snapshot.forEach(doc => allData.push(doc.data()));
        const filteredData = allData.filter(d => d.date >= startInput.value && d.date <= endInput.value);

        renderKPIs(filteredData);
        setTimeout(() => { renderCharts(filteredData, allData, startInput.value); }, 50);
    } catch (error) { console.error("Erro dashboard:", error); }
}

function renderKPIs(data) {
    let t = { deb:0, pag:0, disp:0, canc:0, rec:0, nEmail:0, aEmail:0, nInfo:0, aInfo:0, term:0 };
    data.forEach(d => {
        t.deb+=Number(d.debitos||0); t.pag+=Number(d.pagamentos||0); t.disp+=Number(d.disparos||0); t.canc+=Number(d.cancelamentos||0);
        t.rec+=Number(d.receitaPerdida||0); t.nEmail+=Number(d.negociacoesEmail||0); t.aEmail+=Number(d.acordosEmail||0);
        t.nInfo+=Number(d.negociacoesInfo||0); t.aInfo+=Number(d.acordosInfo||0); t.term+=Number(d.termos||0);
    });

    const percRec = t.deb>0 ? ((t.pag/t.deb)*100).toFixed(2) : "0.00";
    const fmt = (v) => v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    const icon = '<span style="font-size:14px; margin-right:4px;">💬</span>';

    const cards = [
        { l:"💰 DÉBITO", v:fmt(t.deb), c:"#333" }, 
        { l:"✅ PAGAMENTO", v:fmt(t.pag), c:"#28a745" },
        { l:"📊 % RECUP.", v:percRec+"%", c:"#0d47a1" }, 
        { l:"🚀 DISPAROS", v:t.disp, c:"#e65100" },
        { l:"🚫 CANC.", v:t.canc, c:"#c62828" }, 
        { l:"💸 REC. PERDIDA", v:fmt(t.rec), c:"#c62828" },
        { l:"📧 NEG. EMAIL", v:t.nEmail, c:"#555" }, 
        { l:"🤝 ACORD. EMAIL", v:t.aEmail, c:"#555" },
        { l:`${icon} NEG. INFOBIP`, v:t.nInfo, c:"#f16925" }, 
        { l:`${icon} ACORD. INFOBIP`, v:t.aInfo, c:"#f16925" },
        { l:"📄 TERMOS", v:t.term, c:"#555" }
    ];

    const container = document.getElementById('juridico-kpi-container');
    if(container) {
        container.innerHTML = cards.map(c => `
            <div class="kpi-card-jur" style="border-left-color: ${c.c};">
                <div class="kpi-label">${c.l}</div>
                <div class="kpi-value">${c.v}</div>
            </div>
        `).join('');
    }
}

// ======================================================
// 4. GRÁFICOS (IMPLEMENTAÇÃO CORRIGIDA)
// ======================================================
function renderCharts(filteredData, allData, startDateStr) {
    const fmtMoney = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
    const fmtInt = (v) => new Intl.NumberFormat('pt-BR').format(v);
    const fmtCompactMoney = (v) => "R$ " + new Intl.NumberFormat('pt-BR', { notation: "compact", compactDisplay: "short" }).format(v);

    // --- 1. FUNIL ---
    const sDisp = filteredData.reduce((a,b)=>a+Number(b.disparos||0),0);
    const sNeg = filteredData.reduce((a,b)=>a+Number(b.negociacoesInfo||0)+Number(b.negociacoesEmail||0),0);
    const sAco = filteredData.reduce((a,b)=>a+Number(b.acordosInfo||0)+Number(b.acordosEmail||0),0);
    const txNeg = sDisp > 0 ? ((sNeg / sDisp) * 100).toFixed(1) + '%' : '0%';
    const txAco = sDisp > 0 ? ((sAco / sDisp) * 100).toFixed(1) + '%' : '0%';

    createChart('chart-jur-funil', 'bar', {
        labels: ['Disparos', 'Negociações', 'Acordos'],
        datasets: [{ 
            label: 'Volume', data: [sDisp, sNeg, sAco], 
            backgroundColor: ['#e65100', '#0288d1', '#28a745'], 
            borderRadius: 6, barPercentage: 0.6 
        }]
    }, { 
        indexAxis: 'x', 
        layout: { padding: { top: 40 } }, // Padding extra no topo
        plugins: { 
            legend: { display: false },
            // APLICA A CONFIGURAÇÃO DE FORÇA BRUTA
            datalabels: {
                ...FORCE_LABELS,
                formatter: (value) => value > 0 ? fmtInt(value) : ''
            },
            tooltip: { callbacks: { label: (c) => `Qtd: ${c.raw}`, afterLabel: (c) => (c.label==='Negociações' ? `Conv: ${txNeg}` : c.label==='Acordos' ? `Conv: ${txAco}` : '') } }
        },
        scales: { 
            x: { grid: { display: false } }, 
            y: { beginAtZero: true, display: false } // Esconde eixo Y para limpar visual
        } 
    });

    // --- 2. RECUPERAÇÃO ---
    const currStart = new Date(startDateStr);
    const prevMonthDate = new Date(currStart); prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    const prevStartStr = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), 1).toISOString().split('T')[0];
    const prevEndStr = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, 0).toISOString().split('T')[0];

    const prevData = allData.filter(d => d.date >= prevStartStr && d.date <= prevEndStr);
    const currentData = filteredData;

    const getWeeklyAccumulated = (dataset, isFullMonth) => {
        const weeklyData = [0, 0, 0, 0, 0];
        let totalAcumulado = 0;
        const daySums = {};
        dataset.forEach(d => {
            const day = parseInt(d.date.split('-')[2]);
            daySums[day] = (daySums[day] || 0) + Number(d.pagamentos || 0);
        });
        for (let day = 1; day <= 31; day++) {
            if (daySums[day]) totalAcumulado += daySums[day];
            let weekIndex = -1;
            if (day <= 7) weekIndex = 0; else if (day <= 14) weekIndex = 1; else if (day <= 21) weekIndex = 2; else if (day <= 28) weekIndex = 3; else weekIndex = 4;                
            if (isFullMonth) weeklyData[weekIndex] = totalAcumulado;
            else if (daySums[day] !== undefined || day <= new Date().getDate()) weeklyData[weekIndex] = totalAcumulado;
        }
        if (!isFullMonth) {
            const today = new Date().getDate();
            const currentWeek = Math.ceil(today / 7) - 1; 
            return weeklyData.filter((val, index) => index <= currentWeek || val > 0);
        }
        return weeklyData;
    };

    createChart('chart-jur-recuperacao', 'line', {
        labels: ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4', 'Semana 5'],
        datasets: [
            { 
                label: 'Mês Atual', data: getWeeklyAccumulated(currentData, false), 
                borderColor: '#0d47a1', backgroundColor: 'rgba(13, 71, 161, 0.1)', 
                fill: true, tension: 0.4, borderWidth: 3, pointRadius: 4,
                datalabels: {
                    ...FORCE_LABELS,
                    align: 'top', anchor: 'center', offset: 8,
                    color: '#0d47a1',
                    formatter: (value) => value > 0 ? fmtCompactMoney(value) : ''
                }
            },
            { 
                label: 'Mês Anterior', data: getWeeklyAccumulated(prevData, true), 
                borderColor: '#adb5bd', borderDash: [5, 5], 
                fill: false, tension: 0.4, borderWidth: 2, pointRadius: 0,
                datalabels: { display: false } 
            }
        ]
    }, { 
        interaction: { mode: 'index', intersect: false }, 
        layout: { padding: { top: 30 } },
        scales: { 
            y: { beginAtZero: true, ticks: { callback: fmtMoney }, grid: { color: '#f0f0f0' } },
            x: { grid: { display: false } }
        }
    });

    // --- 3. HISTÓRICO ---
    const mapM={}; allData.forEach(d=>{ const k=d.date.substring(0,7); mapM[k]=(mapM[k]||0)+Number(d.disparos||0); });
    const sortM=Object.keys(mapM).sort().slice(-12);
    createChart('chart-jur-historico', 'bar', {
        labels: sortM, 
        datasets:[{ 
            label:'Disparos', data:sortM.map(m=>mapM[m]), 
            backgroundColor:'#0288d1', borderRadius:4, barPercentage: 0.6
        }]
    }, { 
        layout: { padding: { top: 40 } },
        scales:{x:{grid:{display:false}}, y: { display: false }},
        plugins: {
            legend: { display: false },
            datalabels: { ...FORCE_LABELS, formatter: (value) => value > 0 ? fmtInt(value) : '' }
        }
    });

    // --- 4. COMPARATIVO ANUAL ---
    const titleEl = document.querySelector('#chart-jur-anual')?.closest('.chart-card')?.querySelector('h3');
    if(titleEl) titleEl.innerText = "Comparativo Q4 (Out-Dez) 2024 vs 2025";

    const st={2024:{d:0,db:0,p:0}, 2025:{d:0,db:0,p:0}};
    allData.forEach(d=>{ 
        const dateParts = d.date.split('-'); 
        const year = dateParts[0];
        const month = parseInt(dateParts[1]); 
        if (month >= 10 && st[year]) {
            st[year].d += Number(d.disparos||0); 
            st[year].db += Number(d.debitos||0); 
            st[year].p += Number(d.pagamentos||0); 
        }
    });

    createChart('chart-jur-anual', 'bar', {
        labels: ['Disparos', 'Débitos', 'Pagamentos'],
        datasets: [
            { label: '2024', data: [st[2024].d, st[2024].db, st[2024].p], backgroundColor: '#bdc3c7', borderRadius: 5, barPercentage: 0.6 },
            { label: '2025', data: [st[2025].d, st[2025].db, st[2025].p], backgroundColor: '#0d47a1', borderRadius: 5, barPercentage: 0.6 }
        ]
    }, { 
        layout: { padding: { top: 40 } },
        scales:{y:{type:'logarithmic', display: false}}, 
        plugins: {
            datalabels: {
                ...FORCE_LABELS,
                font: { weight: 'bold', size: 10, family: 'Arial' },
                formatter: (value, context) => {
                    if (value === 0) return '';
                    if (context.dataIndex === 0) return fmtInt(value);
                    if (value > 10000) return fmtCompactMoney(value);
                    return fmtMoney(value);
                }
            }
        }
    });
}

function createChart(id, type, data, extraOpts={}) {
    const canvas = document.getElementById(id);
    if (!canvas) return; 
    const ctx = canvas.getContext('2d');
    if(window['chart_'+id] instanceof Chart) window['chart_'+id].destroy();
    
    // Mescla configs, GARANTINDO que os plugins locais venham primeiro se necessário
    // Mas aqui, como definimos 'datalabels' dentro de extraOpts.plugins lá em cima,
    // o Chart.js já vai usar o que passamos.
    
    window['chart_'+id] = new Chart(ctx, {
        type: type,
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            // AQUI ESTÁ O TRUQUE: Permitir plugins externos, mas com configs forçadas
            plugins: {
                legend: { position: 'top', align: 'end', labels: { boxWidth: 12, usePointStyle: true } },
                ...extraOpts.plugins // Isso carrega o nosso FORCE_LABELS
            },
            ...extraOpts // Carrega scales e layout
        }
    });
}

window.initJuridicoDashboard = initJuridicoDashboard;
window.openImportDashJuridico = openImportDashJuridico;
window.processImportDashJuridico = processImportDashJuridico;
window.loadJuridicoDashboard = loadJuridicoDashboard;