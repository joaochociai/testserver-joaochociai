// js/dashboard_juridico.js
import { db } from "./firebase.js";
import { collection, doc, setDoc, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const DASH_COLLECTION = "dashboard_juridico";

// Variáveis globais para os gráficos (para poder destruir e recriar)
let chartFunil = null;
let chartRecup = null;
let chartHist = null;
let chartAnual = null;

// ======================================================
// 1. IMPORTAÇÃO DE DADOS
// ======================================================
export function openImportDashJuridico() {
    document.getElementById('modal-import-dash-juridico').classList.remove('modal-hidden');
}

export async function processImportDashJuridico() {
    const text = document.getElementById('import-dash-juridico-text').value;
    if (!text) return Swal.fire('Ops', 'Cole os dados primeiro.', 'warning');

    const lines = text.trim().split('\n');
    let count = 0;

    // Helper para limpar moeda (R$ 1.000,00 -> 1000.00)
    const cleanMoney = (val) => {
        if (!val) return 0;
        return parseFloat(val.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0;
    };
    // Helper para limpar inteiros
    const cleanInt = (val) => parseInt(val?.replace(/\./g, '').trim()) || 0;

    Swal.fire({ title: 'Importando...', didOpen: () => Swal.showLoading() });

    try {
        const batchPromises = lines.map(async (line) => {
            const cols = line.split('\t');
            if (cols.length < 2) return; // Linha vazia ou inválida

            // Mapeamento das colunas conforme seu pedido
            // 0: Data, 1: Disparos, 2: Débitos, 3: Interações, 4: Negociações (Infobip), 
            // 5: Acordos (Infobip), 6: Pagamentos, 7: Neg. Email, 8: Acordos Email, 
            // 9: Cancelamentos, 10: Rec. Perdida, 11: Termos
            
            const rawDate = cols[0].trim(); // Esperado DD/MM/AAAA
            // Converter data para YYYY-MM-DD para usar como ID e ordenação
            const parts = rawDate.split('/');
            const isoDate = `${parts[2]}-${parts[1]}-${parts[0]}`; // YYYY-MM-DD

            const docData = {
                date: isoDate, // ID e Filtro
                displayDate: rawDate,
                disparos: cleanInt(cols[1]),
                debitos: cleanMoney(cols[2]),
                interacoes: cleanInt(cols[3]),
                negociacoesInfo: cleanInt(cols[4]),
                acordosInfo: cleanInt(cols[5]),
                pagamentos: cleanMoney(cols[6]),
                negociacoesEmail: cleanInt(cols[7]),
                acordosEmail: cleanInt(cols[8]),
                cancelamentos: cleanInt(cols[9]),
                receitaPerdida: cleanMoney(cols[10]),
                termos: cleanInt(cols[11])
            };

            // Usa a data ISO como ID para evitar duplicidade no mesmo dia
            await setDoc(doc(db, DASH_COLLECTION, isoDate), docData);
            count++;
        });

        await Promise.all(batchPromises);

        document.getElementById('modal-import-dash-juridico').classList.add('modal-hidden');
        Swal.fire('Sucesso!', `${count} registros importados.`, 'success');
        loadJuridicoDashboard(); // Atualiza a tela

    } catch (error) {
        console.error(error);
        Swal.fire('Erro', 'Falha na importação. Verifique o formato.', 'error');
    }
}

// ======================================================
// 2. CARREGAMENTO E FILTROS
// ======================================================
export async function loadJuridicoDashboard() {
    // Datas do Filtro
    const startVal = document.getElementById('dash-jur-start').value;
    const endVal = document.getElementById('dash-jur-end').value;

    if (!startVal || !endVal) {
        // Padrão: Mês atual
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        document.getElementById('dash-jur-start').value = firstDay;
        document.getElementById('dash-jur-end').value = lastDay;
        return loadJuridicoDashboard(); // Recarrega com datas padrão
    }

    try {
        // Busca TUDO (pois precisamos de histórico para alguns gráficos) e filtra em memória
        // O Firestore é rápido o suficiente para alguns milhares de registros.
        const q = query(collection(db, DASH_COLLECTION), orderBy("date", "asc"));
        const snapshot = await getDocs(q);
        
        const allData = [];
        snapshot.forEach(doc => allData.push(doc.data()));

        // Dados Filtrados (para KPIs e Gráficos de período)
        const filteredData = allData.filter(d => d.date >= startVal && d.date <= endVal);

        renderKPIs(filteredData);
        renderCharts(filteredData, allData, startVal);

    } catch (error) {
        console.error("Erro dashboard:", error);
    }
}

// ======================================================
// 3. RENDERIZAÇÃO DOS KPIS
// ======================================================
function renderKPIs(data) {
    // Acumuladores
    let totalDebito = 0;
    let totalPago = 0;
    let totalDisparos = 0;
    let totalCanc = 0;
    let totalRecPerdida = 0;
    let totalNegEmail = 0;
    let totalAcordoEmail = 0;
    let totalNegInfo = 0;
    let totalAcordoInfo = 0;
    let totalTermos = 0;

    data.forEach(d => {
        totalDebito += d.debitos;
        totalPago += d.pagamentos;
        totalDisparos += d.disparos;
        totalCanc += d.cancelamentos;
        totalRecPerdida += d.receitaPerdida;
        totalNegEmail += d.negociacoesEmail;
        totalAcordoEmail += d.acordosEmail;
        totalNegInfo += d.negociacoesInfo;
        totalAcordoInfo += d.acordosInfo;
        totalTermos += d.termos;
    });

    const percRecuperado = totalDebito > 0 ? ((totalPago / totalDebito) * 100).toFixed(2) : "0.00";
    const percConv = totalDisparos > 0 ? (((totalNegInfo + totalNegEmail) / totalDisparos) * 100).toFixed(2) : "0.00"; // Exemplo de conversão

    const fmtMoney = (v) => v.toLocaleString('pt-BR', {style:'currency', currency:'BRL'});

    // --- ALTERAÇÃO AQUI ---
    // HTML para o ícone da Infobip (ajustado para alinhar com o texto)
    const iconInfobip = '<img src="infobip-icon.png" alt="ícone infobip" style="height: 14px; width: auto; vertical-align: text-bottom; margin-right: 4px;">';

    // Definição dos Cards
    const cards = [
        { label: "💰 Débito", val: fmtMoney(totalDebito), color: "#333" },
        { label: "✅ Pagamento", val: fmtMoney(totalPago), color: "#28a745" },
        { label: "📊 % Recup.", val: `${percRecuperado}%`, color: "#0d47a1" },
        { label: "🚀 Disparos", val: totalDisparos, color: "#e65100" },
        { label: "🚫 Canc.", val: totalCanc, color: "#c62828" },
        { label: "💸 Rec. Perdida", val: fmtMoney(totalRecPerdida), color: "#c62828" },
        { label: "📧 Neg. Email", val: totalNegEmail, color: "#555" },
        { label: "🤝 Acord. Email", val: totalAcordoEmail, color: "#555" },
        
        // --- NOVOS CARDS INFOBIP COM ÍCONE E COR LARANJA ---
        { label: `${iconInfobip} Neg. Infobip`, val: totalNegInfo, color: "#f16925" },
        { label: `${iconInfobip} Acord. Infobip`, val: totalAcordoInfo, color: "#f16925" },
        
        { label: "📄 Termos", val: totalTermos, color: "#555" }
    ];

    const container = document.getElementById('juridico-kpi-container');
    container.innerHTML = cards.map(c => `
        <div style="background:white; padding:15px; border-radius:8px; border-left: 4px solid ${c.color}; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
            <div style="font-size:12px; color:#777; font-weight:bold; text-transform:uppercase;">${c.label}</div>
            <div style="font-size:18px; font-weight:800; color:#333; margin-top:5px;">${c.val}</div>
        </div>
    `).join('');
}

// ======================================================
// 4. GRÁFICOS (CHART.JS)
// ======================================================
function renderCharts(filteredData, allData, startDateStr) {
    // --- GRÁFICO 1: FUNIL (Disparos -> Negociações -> Acordos) ---
    // Somamos os dados filtrados
    const sumDisparos = filteredData.reduce((a, b) => a + b.disparos, 0);
    const sumNegoc = filteredData.reduce((a, b) => a + b.negociacoesInfo + b.negociacoesEmail, 0);
    const sumAcordos = filteredData.reduce((a, b) => a + b.acordosInfo + b.acordosEmail, 0);

    const ctxFunil = document.getElementById('chart-jur-funil').getContext('2d');
    if (chartFunil) chartFunil.destroy();

    chartFunil = new Chart(ctxFunil, {
        type: 'bar',
        data: {
            labels: ['Disparos', 'Negociações', 'Acordos'],
            datasets: [{
                label: 'Volume',
                data: [sumDisparos, sumNegoc, sumAcordos],
                backgroundColor: ['#e65100', '#0288d1', '#28a745'],
                borderRadius: 5
            }]
        },
        options: {
            indexAxis: 'y', // Barra Horizontal
            plugins: { legend: { display: false } }
        }
    });

    // --- GRÁFICO 2: COMPARATIVO RECUPERAÇÃO (ACUMULADO) ---
    // Comparar Mês Atual (Filtro) vs Mês Anterior
    // Precisamos calcular a data do mês anterior baseada no filtro startVal
    const currentStart = new Date(startDateStr);
    const prevStart = new Date(currentStart);
    prevStart.setMonth(prevStart.getMonth() - 1);
    const prevStartStr = prevStart.toISOString().split('T')[0];
    const prevEndStr = new Date(prevStart.getFullYear(), prevStart.getMonth() + 1, 0).toISOString().split('T')[0];

    const prevData = allData.filter(d => d.date >= prevStartStr && d.date <= prevEndStr);

    // Gerar labels (Dias 1 a 31)
    const labelsDays = Array.from({length: 31}, (_, i) => i + 1);
    
    // Função para acumular valores por dia do mês
    const getAccumulatedData = (dataset) => {
        let acc = 0;
        const result = new Array(31).fill(null); // Null para não desenhar linha se não tiver dia
        
        // Agrupa por dia (1 a 31)
        const dayMap = {};
        dataset.forEach(d => {
            const day = parseInt(d.date.split('-')[2]);
            if(!dayMap[day]) dayMap[day] = 0;
            dayMap[day] += d.pagamentos;
        });

        let currentSum = 0;
        for(let i=1; i<=31; i++) {
            if (dayMap[i] !== undefined) {
                currentSum += dayMap[i];
                result[i-1] = currentSum;
            } else if (i < dataset.length) { // Preencher gaps simples
               // result[i-1] = currentSum; // Opcional: manter linha reta
            }
        }
        // Remove nulls do final para o gráfico parar hoje
        return result.filter(v => v !== null); 
    };

    const dataCurrent = getAccumulatedData(filteredData);
    const dataPrev = getAccumulatedData(prevData);

    const ctxRecup = document.getElementById('chart-jur-recuperacao').getContext('2d');
    if (chartRecup) chartRecup.destroy();

    chartRecup = new Chart(ctxRecup, {
        type: 'line',
        data: {
            labels: labelsDays,
            datasets: [
                {
                    label: 'Atual',
                    data: dataCurrent,
                    borderColor: '#0d47a1',
                    backgroundColor: 'rgba(13, 71, 161, 0.1)',
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Mês Anterior',
                    data: dataPrev,
                    borderColor: '#ffca28',
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.4
                }
            ]
        },
        options: {
            plugins: { tooltip: { mode: 'index', intersect: false } },
            scales: { y: { beginAtZero: true } }
        }
    });


    // --- GRÁFICO 3: VARIAÇÃO DE DISPAROS (HISTÓRICO) ---
    // Ignora filtro, pega últimos 12 meses
    // Agrupar allData por Mês (YYYY-MM)
    const mapMonths = {};
    allData.forEach(d => {
        const key = d.date.substring(0, 7); // YYYY-MM
        if(!mapMonths[key]) mapMonths[key] = 0;
        mapMonths[key] += d.disparos;
    });
    
    // Ordenar chaves e pegar ultimas 12
    const sortedMonths = Object.keys(mapMonths).sort().slice(-12);
    const histValues = sortedMonths.map(m => mapMonths[m]);

    const ctxHist = document.getElementById('chart-jur-historico').getContext('2d');
    if (chartHist) chartHist.destroy();

    chartHist = new Chart(ctxHist, {
        type: 'bar',
        data: {
            labels: sortedMonths, // Ex: 2024-11, 2024-12
            datasets: [{
                label: 'Disparos',
                data: histValues,
                backgroundColor: '#0288d1'
            }]
        }
    });

    // --- GRÁFICO 4: COMPARATIVO ANUAL (2024 x 2025) ---
    // Soma totais por ano
    const stats2024 = { disp:0, deb:0, pag:0 };
    const stats2025 = { disp:0, deb:0, pag:0 };

    allData.forEach(d => {
        const year = d.date.substring(0, 4);
        if (year === '2024') {
            stats2024.disp += d.disparos;
            stats2024.deb += d.debitos;
            stats2024.pag += d.pagamentos;
        } else if (year === '2025') {
            stats2025.disp += d.disparos;
            stats2025.deb += d.debitos;
            stats2025.pag += d.pagamentos;
        }
    });

    const ctxAnual = document.getElementById('chart-jur-anual').getContext('2d');
    if (chartAnual) chartAnual.destroy();

    chartAnual = new Chart(ctxAnual, {
        type: 'bar',
        data: {
            labels: ['Disparos', 'Débitos (R$)', 'Pagamentos (R$)'],
            datasets: [
                {
                    label: '2024',
                    data: [stats2024.disp, stats2024.deb, stats2024.pag],
                    backgroundColor: '#bdc3c7'
                },
                {
                    label: '2025',
                    data: [stats2025.disp, stats2025.deb, stats2025.pag],
                    backgroundColor: '#0d47a1'
                }
            ]
        },
        options: {
            scales: {
                y: { type: 'logarithmic' } // Escala logarítmica ajuda se Débitos for milhões e Disparos for centenas
            }
        }
    });
}

// Exporta globalmente
window.openImportDashJuridico = openImportDashJuridico;
window.processImportDashJuridico = processImportDashJuridico;
window.loadJuridicoDashboard = loadJuridicoDashboard;