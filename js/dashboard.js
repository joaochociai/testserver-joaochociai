import { db } from './firebase.js';
import { collection, query, onSnapshot, writeBatch, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { parseDateBR } from './utils.js';

let unsubscribeCobranca, unsubscribeJuridico, unsubscribeMetricas;
let chartStatus, chartMeta, chartPayment, chartMoM, chartEvolution, chart3CobEvo, chart3CobPie;
let rawRealTimeCobranca = [], rawRealTimeJuridico = [], rawHistoricalData = [];

// --- INICIALIZAÇÃO ---
export function initDashboard() {
    startListeners();
}

function startListeners() {
    // 1. Cobrança RealTime
    const qCob = query(collection(db, 'controle_3_cobranca'));
    unsubscribeCobranca = onSnapshot(qCob, (snap) => {
        rawRealTimeCobranca = snap.docs.map(d => d.data());
        processAllData();
    });

    // 2. Jurídico RealTime
    const qJur = query(collection(db, 'juridico_ligacoes'));
    unsubscribeJuridico = onSnapshot(qJur, (snap) => {
        rawRealTimeJuridico = snap.docs.map(d => d.data());
        processAllData();
    });

    // 3. Histórico (Metricas)
    const qMetricas = query(collection(db, 'metricas_diarias'));
    unsubscribeMetricas = onSnapshot(qMetricas, (snap) => {
        rawHistoricalData = [];
        snap.forEach(docSnap => {
            const dataDia = docSnap.data();
            Object.keys(dataDia).forEach(key => {
                if (key !== 'updatedAt' && typeof dataDia[key] === 'object') {
                    rawHistoricalData.push({
                        dateStr: docSnap.id,
                        etapa: key.replace(/_/g, ' '),
                        ...dataDia[key]
                    });
                }
            });
        });
        processAllData();
    });
}

function processAllData() {
    // Garante que o gráfico de evolução seja renderizado
    if(rawHistoricalData.length > 0) {
        renderEvolutionChart(rawHistoricalData);
    }
    // Aplica filtros e renderiza o restante
    window.applyDashboardFilters();
}

// =========================================================
// FUNÇÕES GLOBAIS (WINDOW) - ESSENCIAIS PARA O HTML FUNCIONAR
// =========================================================

// 1. APLICAR FILTROS
window.applyDashboardFilters = function() {
    const startVal = document.getElementById('dash-date-start')?.value;
    const endVal = document.getElementById('dash-date-end')?.value;
    let startDate = startVal ? parseDateBR(startVal) : null;
    let endDate = endVal ? parseDateBR(endVal) : null;
    if (endDate) endDate.setHours(23, 59, 59, 999);

    // 1. DADOS ESTRITOS (Respeita o filtro exato - Para KPIs e Pizza)
    const filteredHistoryStrict = filterByDate(rawHistoricalData, startDate, endDate);
    
    // 2. DADOS EXPANDIDOS (Mês Completo - Para o Gráfico de Linha)
    let fullMonthStart = null;
    let fullMonthEnd = null;
    let prevFullStart = null;
    let prevFullEnd = null;

    if (startDate) {
        // Pega o primeiro e o último dia do mês da data inicial selecionada
        fullMonthStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        fullMonthEnd = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
        fullMonthEnd.setHours(23, 59, 59, 999);

        // Calcula o mês anterior completo
        prevFullStart = new Date(fullMonthStart);
        prevFullStart.setMonth(prevFullStart.getMonth() - 1);
        
        prevFullEnd = new Date(fullMonthStart); // Começa do dia 1 do mês atual
        prevFullEnd.setDate(0); // Volta 1 dia (último dia do mês anterior)
        prevFullEnd.setHours(23, 59, 59, 999);
    }

    // Se não tiver filtro, usa o histórico total (ou define comportamento padrão)
    const histFullMonthCurr = startDate ? filterByDate(rawHistoricalData, fullMonthStart, fullMonthEnd) : filteredHistoryStrict;
    const histFullMonthPrev = startDate ? filterByDate(rawHistoricalData, prevFullStart, prevFullEnd) : [];

    // --- Filtros Mês Anterior ESTRITO (Para KPIs comparativos se existissem) ---
    let prevStart = null, prevEnd = null;
    if(startDate && endDate) {
        prevStart = new Date(startDate); prevStart.setMonth(prevStart.getMonth() - 1);
        prevEnd = new Date(endDate); prevEnd.setMonth(prevEnd.getMonth() - 1);
    }
    const prevHistoryStrict = filterByDate(rawHistoricalData, prevStart, prevEnd);

    // --- Filtros RealTime ---
    const cobPagos = filterRealTime(rawRealTimeCobranca, startDate, endDate);
    const jurPagos = filterRealTime(rawRealTimeJuridico, startDate, endDate);

    // RENDERIZAÇÃO
    calculateGeneralMetrics(filteredHistoryStrict, cobPagos, jurPagos, prevHistoryStrict);

    // Filtra para 3ª Cobrança
    const hist3CobStrict = filteredHistoryStrict.filter(d => d.etapa.includes('3'));
    
    // Filtra FULL MONTH para o gráfico de evolução
    const hist3CobFullCurr = histFullMonthCurr.filter(d => d.etapa.includes('3'));
    const hist3CobFullPrev = histFullMonthPrev.filter(d => d.etapa.includes('3'));

    // Passamos agora 3 conjuntos de dados: Estrito (KPIs), Full Atual (Gráfico) e Full Anterior (Gráfico)
    renderThirdCobSection(hist3CobStrict, hist3CobFullCurr, hist3CobFullPrev);
};

// 2. LIMPAR FILTROS
window.clearDashboardFilters = function() {
    const startEl = document.getElementById('dash-date-start');
    const endEl = document.getElementById('dash-date-end');
    if(startEl) startEl.value = '';
    if(endEl) endEl.value = '';
    window.applyDashboardFilters();
};

// 3. ABRIR MODAL (A FUNÇÃO QUE ESTAVA DANDO ERRO)
window.openImportBiModal = function() {
    const el = document.getElementById('import-bi-modal');
    if(el) { 
        el.classList.remove('modal-hidden'); 
        el.style.display = 'flex'; 
    } else {
        console.error("Modal #import-bi-modal não encontrado no HTML");
    }
};

// 4. PROCESSAR IMPORTAÇÃO
window.processImportBi = async function() {
    const raw = document.getElementById('import-bi-data').value;
    if(!raw) return alert("Cole os dados.");

    const lines = raw.trim().split('\n');
    let count = 0;
    const batchData = {};

    lines.forEach(line => {
        const cols = line.split('\t');
        if(cols.length < 5) return;
        
        const cleanVal = (v) => (!v ? 0 : parseFloat(v.replace('R$','').replace(/\./g,'').replace(',','.').trim()) || 0);
        const cleanInt = (v) => (!v ? 0 : parseInt(v.trim()) || 0);
        
        const etapa = cols[0].trim();
        const dataStr = cols[1].trim();
        const disparos = cleanInt(cols[2]);
        const debitos = cleanVal(cols[3]);
        const pagamentos = cleanVal(cols[4]);
        
        const pagCartao = cols.length > 6 ? cleanInt(cols[6]) : 0;
        const pagPix = cols.length > 7 ? cleanInt(cols[7]) : 0;
        const pagBoleto = cols.length > 8 ? cleanInt(cols[8]) : 0;

        const parts = dataStr.split('/');
        if(parts.length !== 3) return;
        const docId = `${parts[2]}-${parts[1]}-${parts[0]}`;
        const fieldKey = etapa.replace('º','').replace('°','').replace('ª','').replace(/ /g,'_').normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        if(!batchData[docId]) batchData[docId] = {};
        batchData[docId][fieldKey] = { disparos, debitos, pagamentos, pag_cartao: pagCartao, pag_pix: pagPix, pag_boleto: pagBoleto };
        count++;
    });

    try {
        const batch = writeBatch(db);
        for (const [docId, fields] of Object.entries(batchData)) {
            const docRef = doc(db, "metricas_diarias", docId);
            batch.set(docRef, { ...fields, updatedAt: new Date() }, { merge: true });
        }
        await batch.commit();
        alert(`${count} linhas importadas!`);
        document.getElementById('import-bi-modal').classList.add('modal-hidden');
        document.getElementById('import-bi-modal').style.display = 'none';
        document.getElementById('import-bi-data').value = '';
    } catch(e) { console.error(e); alert("Erro ao importar."); }
};

// =========================================================
// FUNÇÕES AUXILIARES E GRÁFICOS
// =========================================================

function filterByDate(data, start, end) {
    return data.filter(item => {
        if (!start && !end) return true;
        const d = new Date(item.dateStr + 'T12:00:00');
        if (start && d < start) return false;
        if (end && d > end) return false;
        return true;
    });
}

function filterRealTime(data, start, end) {
    return data.filter(item => {
        if (item.Status !== 'Pago' || !item.DataPagamento) return false;
        const d = item.DataPagamento.toDate ? item.DataPagamento.toDate() : new Date(item.DataPagamento);
        if (start && d < start) return false;
        if (end && d > end) return false;
        return true;
    });
}

function renderEvolutionChart(fullData) {
    const map = {};
    fullData.forEach(d => {
        const [ano, mes] = d.dateStr.split('-');
        const key = `${mes}/${ano}`;
        if (!map[key]) map[key] = { debito: 0, pagto: 0, sortKey: `${ano}${mes}` };
        map[key].debito += (d.debitos || 0);
        map[key].pagto += (d.pagamentos || 0);
    });

    const sortedKeys = Object.keys(map).sort((a,b) => map[a].sortKey - map[b].sortKey);
    const seriesDebito = sortedKeys.map(k => map[k].debito);
    const seriesPagto = sortedKeys.map(k => map[k].pagto);

    const options = {
        series: [{ name: 'Débitos', data: seriesDebito }, { name: 'Pagamentos', data: seriesPagto }],
        chart: { type: 'bar', height: 400, toolbar: { show: false } },
        plotOptions: { bar: { horizontal: false, columnWidth: '55%', dataLabels: { position: 'top' } } },
        dataLabels: { enabled: true, offsetY: -20, style: { fontSize: '11px', colors: ['#304758'] }, formatter: formatCompact },
        xaxis: { categories: sortedKeys },
        yaxis: { labels: { formatter: formatCompact } },
        colors: ['#007bff', '#9fc5e8'],
        legend: { position: 'top', horizontalAlign: 'left' },
        title: { text: undefined }
    };

    if (chartEvolution) {
        chartEvolution.updateOptions({ xaxis: { categories: sortedKeys } });
        chartEvolution.updateSeries(options.series);
    } else {
        const el = document.querySelector("#chart-bar-evolution");
        if(el) {
            chartEvolution = new ApexCharts(el, options);
            chartEvolution.render();
        }
    }
}

function calculateGeneralMetrics(history, cobPagos, jurPagos, prevHistory) {
    let debito = 0, pagto = 0, disparos = 0;
    let mapPgto = {};

    history.forEach(d => {
        debito += (d.debitos || 0);
        pagto += (d.pagamentos || 0);
        disparos += (d.disparos || 0);
        mapPgto['Cartão'] = (mapPgto['Cartão']||0) + (d.pag_cartao||0);
        mapPgto['Pix'] = (mapPgto['Pix']||0) + (d.pag_pix||0);
        mapPgto['Boleto'] = (mapPgto['Boleto']||0) + (d.pag_boleto||0);
    });

    const sum = (arr) => arr.reduce((acc, i) => acc + (getVal(i.Valor)), 0);
    pagto += sum(cobPagos) + sum(jurPagos);

    [...cobPagos, ...jurPagos].forEach(p => {
        let f = p.OrigemPagamento || 'Outros';
        if(f.toLowerCase().includes('pix')) f='Pix';
        else if(f.toLowerCase().includes('cart')) f='Cartão';
        else if(f.toLowerCase().includes('boleto')) f='Boleto';
        mapPgto[f] = (mapPgto[f]||0)+1;
    });

    updateEl('kpi-debito-total', formatMoney(debito));
    updateEl('kpi-pagamento-total', formatMoney(pagto));
    updateEl('kpi-disparos', disparos);
    updateEl('kpi-conversao', debito>0 ? ((pagto/debito)*100).toFixed(2)+'%' : '0%');

    renderStatusChart(history);
    renderMetaChart(pagto, debito);
    renderMoMChart(history, prevHistory);
    renderPaymentChart(mapPgto);
}

function renderThirdCobSection(dataStrict, dataFullCurr, dataFullPrev) {
    
    // --- PARTE 1: KPIs e PIZZA (Usa dataStrict) ---
    let debito = 0, pagto = 0, disparos = 0;

    dataStrict.forEach(d => {
        debito += (d.debitos || 0);
        pagto += (d.pagamentos || 0);
        disparos += (d.disparos || 0);
    });

    updateEl('kpi-3cob-debito', formatMoney(debito));
    updateEl('kpi-3cob-pago', formatMoney(pagto));
    updateEl('kpi-3cob-disparos', disparos);
    updateEl('kpi-3cob-conv', debito>0 ? ((pagto/debito)*100).toFixed(2)+'%' : '0%');

    // Gráfico Pizza (Mantido com dados estritos)
    const optionsPie = {
        series: [Math.max(0, debito - pagto), pagto],
        chart: { type: 'donut', height: 300 },
        labels: ['Em Aberto', 'Recuperado'],
        colors: ['#34495e', '#2ecc71'],
        legend: { position: 'bottom' },
        dataLabels: { enabled: true, formatter: (val) => val.toFixed(1) + "%" }
    };

    if (chart3CobPie) { chart3CobPie.updateSeries(optionsPie.series); } 
    else { 
        const el = document.querySelector("#chart-3cob-pie");
        if(el) {
            chart3CobPie = new ApexCharts(el, optionsPie); 
            chart3CobPie.render(); 
        }
    }

    // --- PARTE 2: GRÁFICO DE EVOLUÇÃO (Usa dataFullCurr e dataFullPrev) ---
    
    // Mapa: Semana (1-5) -> Valores
    const evoMap = { 1:{}, 2:{}, 3:{}, 4:{}, 5:{} };
    for(let i=1; i<=5; i++) evoMap[i] = { currDeb:0, currPag:0, prevDeb:0, prevPag:0 };

    const getWeek = (dateStr) => {
        const day = parseInt(dateStr.split('-')[2]);
        if (day <= 7) return 1;
        if (day <= 14) return 2;
        if (day <= 21) return 3;
        if (day <= 28) return 4;
        return 5;
    };

    // Processa Mês Atual COMPLETO
    dataFullCurr.forEach(d => {
        const w = getWeek(d.dateStr);
        evoMap[w].currDeb += (d.debitos || 0);
        evoMap[w].currPag += (d.pagamentos || 0);
    });

    // Processa Mês Anterior COMPLETO
    dataFullPrev.forEach(d => {
        const w = getWeek(d.dateStr);
        evoMap[w].prevDeb += (d.debitos || 0);
        evoMap[w].prevPag += (d.pagamentos || 0);
    });

    const weeks = [1, 2, 3, 4, 5];
    const categories = weeks.map(w => `Semana ${w}`);
    
    const seriesCurr = weeks.map(w => {
        const i = evoMap[w];
        return i.currDeb > 0 ? ((i.currPag / i.currDeb) * 100).toFixed(1) : 0;
    });
    
    const seriesPrev = weeks.map(w => {
        const i = evoMap[w];
        return i.prevDeb > 0 ? ((i.prevPag / i.prevDeb) * 100).toFixed(1) : 0;
    });

    const optionsEvo = {
        series: [
            { name: 'Mês Passado', data: seriesPrev }, // Série Índice 0 (Sem rótulo)
            { name: 'Mês Atual', data: seriesCurr }    // Série Índice 1 (Com rótulo)
        ],
        chart: { 
            type: 'line', 
            height: 300, 
            toolbar: { show: false },
            parentHeightOffset: 0
        },
        
        // Garante comportamento de linha
        plotOptions: { line: {} },

        // --- RÓTULOS APENAS NO MÊS ATUAL ---
        dataLabels: { 
            enabled: true, 
            enabledOnSeries: [1], // <--- O SEGREDO: Ativa só na Série 1 (Mês Atual)
            formatter: (v) => v + '%',
            textAnchor: 'middle',
            offsetY: -10, // Flutua um pouco acima da bolinha
            style: { 
                fontSize: '10px', 
                colors: ['#333'],
                fontWeight: 'bold'
            },
            background: { 
                enabled: true, 
                foreColor: '#ffffff', 
                padding: 4, 
                borderRadius: 4,
                borderWidth: 1, 
                borderColor: '#ccc',
                opacity: 0.9,
                dropShadow: { enabled: false }
            }
        },
        // -----------------------------------

        stroke: { curve: 'smooth', width: 3 },
        xaxis: { categories: categories },
        colors: ['#adb5bd', '#e67e22'], // Cinza (0) e Laranja (1)
        yaxis: { 
            labels: { formatter: (v) => v + '%' },
            min: 0,
            forceNiceScale: true 
        },
        legend: { position: 'top' },
        title: { text: undefined },
        tooltip: {
            enabled: true,
            shared: true,
            intersect: false,
            y: { formatter: (val) => val + "%" }
        },
        grid: {
            padding: { top: 20, bottom: 10, left: 10, right: 10 }
        }
    };

    if (chart3CobEvo) {
        chart3CobEvo.updateOptions({ xaxis: { categories: categories } });
        chart3CobEvo.updateSeries(optionsEvo.series);
    } else {
        const el = document.querySelector("#chart-3cob-evolution-line");
        if(el) {
            chart3CobEvo = new ApexCharts(el, optionsEvo);
            chart3CobEvo.render();
        }
    }
}

function renderMoMChart(curr, prev) {
    const calc = (list) => {
        const m = {};
        list.forEach(d => {
            const n = d.etapa;
            if(!m[n]) m[n]={d:0,p:0};
            m[n].d+=d.debitos; m[n].p+=d.pagamentos;
        });
        const res = {};
        Object.keys(m).forEach(k => res[k] = m[k].d>0 ? ((m[k].p/m[k].d)*100).toFixed(1) : 0);
        return res;
    };
    const cMap = calc(curr);
    const pMap = calc(prev);
    const allCats = [...new Set([...Object.keys(cMap), ...Object.keys(pMap)])].sort();
    
    const sC = allCats.map(k=>cMap[k]||0);
    const sP = allCats.map(k=>pMap[k]||0);

    const opts = {
        series: [
            { name: 'Mês Passado', data: sP },
            { name: 'Mês Atual', data: sC }
        ],
        chart: { type: 'line', height: 350, toolbar: { show: false } },
        stroke: { curve: 'smooth', width: 3 },
        colors: ['#adb5bd', '#007bff'],
        dataLabels: { 
            enabled: true, 
            formatter: (val) => val + "%",
            style: { fontSize: '10px' },
            background: { enabled: true, foreColor: '#000', borderRadius: 2 }
        },
        xaxis: { categories: allCats },
        yaxis: { labels: { formatter: (val) => val + "%" } },
        legend: { position: 'top' }
    };
    if(chartMoM){ chartMoM.updateOptions({xaxis:{categories:allCats}}); chartMoM.updateSeries(opts.series); }
    else{ 
        const el = document.querySelector("#chart-line-mom");
        if(el) {
            chartMoM = new ApexCharts(el, opts); 
            chartMoM.render(); 
        }
    }
}

function renderStatusChart(history) {
    const porEtapa = {};
    history.forEach(d => {
        const n = d.etapa || 'Outros';
        if(!porEtapa[n]) porEtapa[n]={deb:0, pag:0};
        porEtapa[n].deb += d.debitos; porEtapa[n].pag += d.pagamentos;
    });
    const cats = Object.keys(porEtapa).sort();
    const sDeb = cats.map(c=>porEtapa[c].deb);
    const sPag = cats.map(c=>porEtapa[c].pag);
    
    const opts = {
        series: [{name:'Débitos',data:sDeb}, {name:'Pagamentos',data:sPag}],
        chart: {type:'bar', height:350, toolbar:{show:false}},
        plotOptions:{bar:{horizontal:true, dataLabels:{position:'top'}}},
        dataLabels:{enabled:true, formatter:v=>"R$ "+v.toLocaleString('pt-BR',{maximumFractionDigits:0}), offsetX:30, style:{colors:['#333']}},
        colors:['#007bff','#28a745'],
        xaxis:{categories:cats}
    };
    if(chartStatus){ chartStatus.updateOptions({xaxis:{categories:cats}}); chartStatus.updateSeries(opts.series); }
    else{ 
        const el = document.querySelector("#chart-bar-status");
        if(el) {
            chartStatus = new ApexCharts(el, opts); 
            chartStatus.render(); 
        }
    }
}

function renderMetaChart(a, t) {
    const p = t>0 ? Math.round((a/t)*100) : 0;
    const opts = { series:[p], chart:{type:'radialBar', height:340}, plotOptions:{radialBar:{hollow:{size:'65%'}, dataLabels:{value:{offsetY:10, fontSize:'30px', show:true, formatter:v=>v+'%'}}}}, fill:{colors:['#28a745']}, labels:['Recuperação'] };
    const txt = document.getElementById('meta-text-display');
    if(txt) txt.innerText = `${formatMoney(a)} / ${formatMoney(t)}`;
    
    if(chartMeta) chartMeta.updateSeries([p]); 
    else { 
        const el = document.querySelector("#chart-gauge-meta");
        if(el) {
            chartMeta = new ApexCharts(el, opts); 
            chartMeta.render(); 
        }
    }
}

function renderPaymentChart(map) {
    Object.keys(map).forEach(k=>{if(map[k]===0)delete map[k]});
    const opts = { series:Object.values(map), labels:Object.keys(map), chart:{type:'donut', height:320}, colors:['#008FFB', '#00E396', '#FEB019', '#FF4560'] };
    if(chartPayment){ chartPayment.updateOptions({labels:Object.keys(map)}); chartPayment.updateSeries(Object.values(map)); }
    else{ 
        const el = document.querySelector("#chart-pie-payment");
        if(el) {
            chartPayment = new ApexCharts(el, opts); 
            chartPayment.render(); 
        }
    }
}

function getVal(v) { return typeof v==='string'?parseFloat(v.replace('R$','').replace(/\./g,'').replace(',','.')):(v||0); }
function formatMoney(v) { return v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function formatCompact(v) { if(v>=1000000)return "R$ "+(v/1000000).toLocaleString('pt-BR',{maximumFractionDigits:2})+" Mi"; if(v>=1000)return "R$ "+(v/1000).toLocaleString('pt-BR',{maximumFractionDigits:0})+" Mil"; return "R$ "+v; }
function updateEl(id, v) { const e=document.getElementById(id); if(e)e.textContent=v; }

export function stopDashboard() {
    if(unsubscribeCobranca) unsubscribeCobranca();
    if(unsubscribeJuridico) unsubscribeJuridico();
    if(unsubscribeMetricas) unsubscribeMetricas();
}