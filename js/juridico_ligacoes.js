// js/juridico_ligacoes.js
import { db, auth } from "./firebase.js";
import {
  collection, addDoc, getDocs, query, orderBy, updateDoc, doc, arrayUnion, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { parseDateBR, formatDateUTC, mapStatusToLabel } from "./utils.js";

export const JURIDICO_COLLECTION = 'juridico_ligacoes';
window.JURIDICO_COLLECTION = JURIDICO_COLLECTION;

window.juridicoList = [];
let currentJuridicoActionId = null;

// -------------------------
// 1. CARREGAMENTO COM FILTRO DE DIAS
// -------------------------
export async function loadJuridicoLigacoes() {
  const container = document.getElementById('juridico-ligacoes-list');
  if (container) container.innerHTML = '<div class="loader"></div>';

  try {
    const q = query(collection(db, JURIDICO_COLLECTION), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    const rawList = [];
    snap.forEach(s => rawList.push({ id: s.id, ...s.data() }));

    // --- APLICAÇÃO DA REGRA DE NEGÓCIO (46 a 59 DIAS) ---
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    window.juridicoList = rawList.filter(item => {
        // Se já estiver baixado/pago, não mostra (opcional, mas recomendado)
        if (item.Status === 'Pago') return false;

        // Se não tiver vencimento, mostra por segurança (ou oculte se preferir)
        if (!item.Vencimento) return true;

        const dataVenc = parseDateBR(item.Vencimento);
        if (!dataVenc) return true; // Data inválida, mostra para corrigir

        dataVenc.setHours(0, 0, 0, 0);
        
        // Cálculo de dias de atraso
        const diffTime = hoje - dataVenc;
        const diasAtraso = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        // Salva o cálculo no item para usar no visual depois
        item.diasAtrasoCalculado = diasAtraso;

        // REGRA: Entra no dia 46 (pós 1ª Jurídica) e sai no dia 60 (2ª Jurídica)
        // Intervalo: [46, 59]
        return diasAtraso >= 46 && diasAtraso < 60;
    });

    // Atualiza o contador da tela
    const totalEl = document.getElementById('total-juridico-count');
    if (totalEl) totalEl.textContent = window.juridicoList.length;

    renderJuridicoList(window.juridicoList);

  } catch (err) {
    console.error("Erro ao carregar juridico ligacoes:", err);
    if (container) container.innerHTML = '<p>Erro ao carregar dados.</p>';
  }
}
window.loadJuridicoLigacoes = loadJuridicoLigacoes;

// -------------------------
// 2. RENDER LIST
// -------------------------
export function renderJuridicoList(data) {
  const container = document.getElementById('juridico-ligacoes-list');
  if (!container) return;
  container.innerHTML = '';

  if (!data || data.length === 0) {
    container.innerHTML = '<p class="empty-msg">Nenhum aluno na fase de ligação (46-59 dias).</p>';
    return;
  }

  const sortedData = data.sort((a, b) => (a.diasAtrasoCalculado || 0) - (b.diasAtrasoCalculado || 0));

  sortedData.forEach(item => {
    // ... (resto do código igual)
    const dataVenc = item.Vencimento || '-';
    const ligaCount = item.LigaEtapa || 0;
    const msgCount = item.TemplateEtapa || 0;
    const safeClass = (item.StatusExtra?.tipo || 'nenhum').replace(/_/g,'-').toLowerCase();
    
    // Badge de dias de atraso
    const diasLabel = item.diasAtrasoCalculado 
        ? `<span style="background:#ffebee; color:#c62828; padding:2px 6px; border-radius:4px; font-size:11px; font-weight:bold; margin-left:5px;">${item.diasAtrasoCalculado} dias atraso</span>`
        : '';

    const card = document.createElement('div');
    card.className = `cobranca-card juridico-card status-${safeClass}`;
    card.innerHTML = `
      <div class="card-info">
        <h3>${item.Nome || '-'}</h3>
        <p style="margin-top:10px;"><strong>Curso:</strong> ${item.Curso || '-'}</p>
        <p><strong>Valor Parcela:</strong> ${item.ValorParcela || '-'} | <strong>Total:</strong> ${item.TotalAberto || '-'}</p>
        <p><strong>Vencimento:</strong> ${dataVenc} ${diasLabel}</p>
        <p style="margin-top:6px; font-size:12px; color:#555;">
          📞 ${ligaCount} | 💬 ${msgCount}
        </p>
        <p class="limit-date">⚠️ 1ª Jurídica em: ${formatDateUTC(item.Data1Jur)}</p>
        ${ item.StatusExtra?.tipo ? `<p class="extra-status">${mapStatusToLabel(item.StatusExtra.tipo)}</p>` : '' }
      </div>
      <div class="card-actions">
        <button class="btn-actions-open" onclick="window.openActionsModalJuridico('${item.id}')">⚡ Ações</button>
        <div class="small-actions"><button class="icon-btn trash-icon admin-only" onclick="window.archiveJuridico('${item.id}')">🗑️</button></div>
      </div>
    `;
    container.appendChild(card);
  });
}
window.renderJuridicoList = renderJuridicoList;

// -------------------------
// 3. IMPORTAÇÃO (COLAR)
// -------------------------
export function openImportModalJuridico() {
  const o = document.getElementById('import-modal-juridico');
  if (o) { o.classList.remove('modal-hidden'); o.style.display = 'flex'; }
}
window.openImportModalJuridico = openImportModalJuridico;

export function closeImportModalJuridico() {
  const o = document.getElementById('import-modal-juridico');
  if (o) { o.classList.add('modal-hidden'); o.style.display = 'none'; }
}
window.closeImportModalJuridico = closeImportModalJuridico;

export async function processImportJuridico() {
  const raw = document.getElementById('import-data-juridico')?.value || '';
  if (!raw) return alert('Cole os dados primeiro.');

  const lines = raw.trim().split('\n');
  let success = 0;

  try {
    const promises = lines.map(async row => {
      const cols = row.split('\t').map(c => c.trim());
      if (cols.length < 9) return;

      const data1jur = parseDateBR(cols[8]) || null;
      // Importante: Vencimento deve vir no formato DD/MM/AAAA para o cálculo funcionar
      const newItem = {
        Curso: cols[0] || '',
        Nome: cols[1] || '',
        Email: cols[2] || '',
        CPF: cols[3] || '',
        Telefone: cols[4] || '',
        ValorParcela: cols[5] || '',
        TotalAberto: cols[6] || '',
        Vencimento: cols[7] || '', // Usado para calcular os 46-59 dias
        Data1Jur: data1jur,
        LigaEtapa: 0,
        TemplateEtapa: 0,
        Status: 'Ativo',
        createdAt: new Date(),
        createdBy: auth.currentUser?.email || 'Sistema'
      };
      await addDoc(collection(db, JURIDICO_COLLECTION), newItem);
      success++;
    });

    await Promise.all(promises);
    closeImportModalJuridico();
    
    // Pequeno delay para garantir que o Firestore salvou antes de recarregar
    setTimeout(() => {
        alert(`${success} registros importados!\n(Apenas os que tiverem entre 46-59 dias de atraso aparecerão na lista)`);
        loadJuridicoLigacoes();
    }, 500);
    
  } catch (err) {
    console.error(err);
    alert('Erro ao importar.');
  }
}
window.processImportJuridico = processImportJuridico;

// -------------------------
// 4. MODAL DE AÇÕES (EXCLUSIVO)
// -------------------------
export function openActionsModalJuridico(id) {
  const item = window.juridicoList.find(x => x.id === id);
  if (!item) return;

  currentJuridicoActionId = id;

  document.getElementById('juridico-actions-student-name').textContent = item.Nome || '—';
  document.getElementById('juridico-actions-student-details').innerHTML = `
    <p><strong>Email:</strong> ${item.Email || '-'}</p>
    <p><strong>Telefone:</strong> ${item.Telefone || '-'}</p>
    <p><strong>CPF:</strong> ${item.CPF || '-'}</p>
    <p><strong>Vencimento:</strong> ${item.Vencimento || '-'}</p>
    <p><strong>Total Aberto:</strong> ${item.TotalAberto || '-'}</p>
  `;

  const sel = document.getElementById('juridico-extra-status-select');
  if (sel) sel.value = item.StatusExtra?.tipo || '';

  if (item.Propostas) {
      for (let i=1;i<=4;i++){
        const el = document.getElementById(`jur-prop-${i}`);
        if(el) el.value = item.Propostas[`p${i}`] || '';
      }
  } else {
      for (let i=1;i<=4;i++){
        const el = document.getElementById(`jur-prop-${i}`);
        if(el) el.value = '';
      }
  }

  updateJuridicoStageButtons(item);

  const overlay = document.getElementById('actions-modal-juridico');
  if (overlay) { overlay.classList.remove('modal-hidden'); overlay.style.display = 'flex'; }
}
window.openActionsModalJuridico = openActionsModalJuridico;

export function closeActionsModalJuridico() {
  const overlay = document.getElementById('actions-modal-juridico');
  if (overlay) { overlay.classList.add('modal-hidden'); overlay.style.display = 'none'; }
}
window.closeActionsModalJuridico = closeActionsModalJuridico;

// -------------------------
// 5. ETAPAS & LOGS (LIGAÇÃO/TEMPLATE)
// -------------------------
function getCurrentEmail() {
  return auth.currentUser?.email || window.currentUser?.email || 'Sistema';
}

export function updateJuridicoStageButtons(item) {
  const callBtn = document.getElementById('juridico-btn-next-call');
  const tempBtn = document.getElementById('juridico-btn-next-template');
  const info = document.getElementById('juridico-last-action-info');

  const callStep = (item.LigaEtapa || 0) + 1;
  const tempStep = (item.TemplateEtapa || 0) + 1;

  if (callBtn) callBtn.textContent = `📞 Ligar #${callStep}`;
  if (tempBtn) tempBtn.textContent = `💬 Template #${tempStep}`;

  if (info && item.UltimaAcao) {
    const d = item.UltimaAcao.toDate ? item.UltimaAcao.toDate() : new Date(item.UltimaAcao);
    info.innerHTML = `Última: ${d.toLocaleString('pt-BR')}<br><small>Por: ${item.UltimoResponsavel || 'Sistema'}</small>`;
  } else if (info) info.textContent = '';
}
window.updateJuridicoStageButtons = updateJuridicoStageButtons;

export async function nextCallStageJuridico() {
  if (!currentJuridicoActionId) return;
  const item = window.juridicoList.find(x => x.id === currentJuridicoActionId);
  if (!item) return;

  const nova = (item.LigaEtapa || 0) + 1;
  const user = getCurrentEmail();

  try {
    await updateDoc(doc(db, JURIDICO_COLLECTION, item.id), {
      LigaEtapa: nova,
      UltimaAcao: new Date(),
      UltimoResponsavel: user,
      HistoricoLogs: arrayUnion({
        tipo: 'ligacao', etapa: nova, responsavel: user, timestamp: new Date().toISOString()
      })
    });

    item.LigaEtapa = nova;
    item.UltimaAcao = new Date();
    item.UltimoResponsavel = user;

    updateJuridicoStageButtons(item);
    renderJuridicoList(window.juridicoList);
  } catch (err) {
    console.error(err);
    alert("Erro ao salvar etapa de ligação.");
  }
}
window.nextCallStageJuridico = nextCallStageJuridico;

export async function nextTemplateStageJuridico() {
  if (!currentJuridicoActionId) return;
  const item = window.juridicoList.find(x => x.id === currentJuridicoActionId);
  if (!item) return;

  const nova = (item.TemplateEtapa || 0) + 1;
  const user = getCurrentEmail();

  try {
    await updateDoc(doc(db, JURIDICO_COLLECTION, item.id), {
      TemplateEtapa: nova,
      UltimaAcao: new Date(),
      UltimoResponsavel: user,
      HistoricoLogs: arrayUnion({
        tipo: 'template', etapa: nova, responsavel: user, timestamp: new Date().toISOString()
      })
    });

    item.TemplateEtapa = nova;
    item.UltimaAcao = new Date();
    item.UltimoResponsavel = user;

    updateJuridicoStageButtons(item);
    renderJuridicoList(window.juridicoList);
  } catch (err) {
    console.error(err);
    alert("Erro ao salvar etapa de template.");
  }
}
window.nextTemplateStageJuridico = nextTemplateStageJuridico;

// -------------------------
// 6. PROPOSTAS (onblur)
// -------------------------
export async function saveProposalJuridico(index) {
  if (!currentJuridicoActionId) return;
  const text = document.getElementById(`jur-prop-${index}`)?.value || '';
  const item = window.juridicoList.find(x => x.id === currentJuridicoActionId);
  if (!item) return;

  if (!item.Propostas) item.Propostas = {};
  const old = item.Propostas[`p${index}`] || '';
  if (old === text) return;

  item.Propostas[`p${index}`] = text;
  const user = getCurrentEmail();

  try {
    await updateDoc(doc(db, JURIDICO_COLLECTION, item.id), {
      Propostas: item.Propostas,
      HistoricoLogs: arrayUnion({
        tipo: 'proposta', detalhe: `Editou proposta ${index}`, conteudo: text.substring(0,80), responsavel: user, timestamp: new Date().toISOString()
      })
    });
    console.log('Proposta salva.');
  } catch (err) {
    console.error('Erro ao salvar proposta:', err);
  }
}
window.saveProposalJuridico = saveProposalJuridico;

// -------------------------
// 7. STATUS EXTRA, PAGAMENTO, ARQUIVO
// -------------------------
export async function saveExtraStatusJuridico() {
  if (!currentJuridicoActionId) return;
  const value = document.getElementById('juridico-extra-status-select')?.value || '';
  const user = getCurrentEmail();

  try {
    await updateDoc(doc(db, JURIDICO_COLLECTION, currentJuridicoActionId), {
      StatusExtra: { tipo: value, atualizadoEm: new Date(), por: user },
      UltimoResponsavel: user
    });

    const idx = window.juridicoList.findIndex(x => x.id === currentJuridicoActionId);
    if (idx > -1) {
      window.juridicoList[idx].StatusExtra = { tipo: value };
      renderJuridicoList(window.juridicoList);
    }
  } catch (err) {
    console.error(err);
    alert('Erro ao salvar status.');
  }
}
window.saveExtraStatusJuridico = saveExtraStatusJuridico;

export async function registerPaymentJuridico() {
  if (!currentJuridicoActionId) return;
  const dateVal = document.getElementById('juridico-payment-date')?.value;
  const origin = document.getElementById('juridico-payment-origin')?.value;
  if (!dateVal || !origin) return alert('Preencha data e origem.');

  if (!confirm('Confirmar pagamento?')) return;
  try {
    await updateDoc(doc(db, JURIDICO_COLLECTION, currentJuridicoActionId), {
      Status: 'Pago',
      DataPagamento: new Date(dateVal),
      OrigemPagamento: origin,
      BaixadoPor: getCurrentEmail()
    });
    alert('Pagamento registrado.');
    closeActionsModalJuridico();
    loadJuridicoLigacoes();
  } catch (err) {
    console.error(err);
    alert('Erro ao registrar pagamento.');
  }
}
window.registerPaymentJuridico = registerPaymentJuridico;

export async function archiveJuridico(id) {
  // ATUALIZADO: Uso do SweetAlert se disponível, ou confirm padrão
  const confirmAction = async () => {
      if (typeof Swal !== 'undefined') {
          const res = await Swal.fire({
              title: 'Excluir?',
              text: "Essa ação é irreversível.",
              icon: 'warning',
              showCancelButton: true,
              confirmButtonColor: '#d33',
              confirmButtonText: 'Sim, excluir'
          });
          return res.isConfirmed;
      }
      return confirm('Remover registro permanentemente?');
  };

  if (!(await confirmAction())) return;

  try {
    await deleteDoc(doc(db, JURIDICO_COLLECTION, id));
    loadJuridicoLigacoes();
    if(typeof Swal !== 'undefined') Swal.fire('Excluído!', '', 'success');
  } catch (err) {
    console.error(err);
    alert('Erro ao excluir.');
  }
}
window.archiveJuridico = archiveJuridico;

// ==========================================
// FILTRO DE BUSCA LOCAL (Barra de pesquisa)
// ==========================================
window.filterJuridicoList = function() {
    const search = document.getElementById('juridico-ligacoes-search').value.toLowerCase();
    
    // Filtra sobre a lista JÁ FILTRADA por data (window.juridicoList)
    const filtered = window.juridicoList.filter(item => 
        (item.Nome || "").toLowerCase().includes(search) ||
        (item.CPF || "").toLowerCase().includes(search) ||
        (item.Email || "").toLowerCase().includes(search)
    );
    
    renderJuridicoList(filtered);
};

// ==========================================
// EXPORTAÇÃO EXCEL (PENDENTES SEM INTERAÇÃO)
// ==========================================
window.exportJuridicoNoInteraction = function() {
    const horasCorte = 3; // Define o padrão de 3 horas
    const agora = new Date();
    const tempoCorte = new Date(agora.getTime() - (horasCorte * 60 * 60 * 1000));

    // 1. Filtra a lista: Sem Tag E Sem envio de Template nas últimas 3h
    const toExport = window.juridicoList.filter(item => {
        // A. Verifica se possui Tag (StatusExtra)
        const temTag = item.StatusExtra && item.StatusExtra.tipo && item.StatusExtra.tipo !== "";
        if (temTag) return false;

        // B. Verifica se houve algum template enviado DEPOIS do tempo de corte
        const logs = item.HistoricoLogs || [];
        const teveTemplateRecente = logs.some(log => {
            if (log.tipo !== 'template') return false;
            const dataLog = new Date(log.timestamp);
            return dataLog > tempoCorte; // Se o log for mais novo que 3h atrás, retorna true
        });

        // Exporta apenas se NÃO tiver tag E NÃO tiver template recente
        return !teveTemplateRecente;
    });

    if (toExport.length === 0) {
        return alert(`Nenhum aluno pendente encontrado (Sem tag e sem template nas últimas ${horasCorte}h).`);
    }

    if(!confirm(`Deseja exportar ${toExport.length} alunos pendentes para Excel?`)) return;

    // 2. Monta a estrutura da Tabela HTML
    let table = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="UTF-8"></head>
        <body>
        <table border="1">
            <thead>
                <tr style="background-color: #0d6efd; color: white;">
                    <th>NOME</th>
                    <th>NUMERO (WHATSAPP)</th>
                    <th>CPF</th>
                    <th>E-MAIL</th>
                    <th>CURSO</th>
                    <th>TOTAL ABERTO</th>
                    <th>VENCIMENTO</th>
                    <th>DIAS ATRASO</th>
                </tr>
            </thead>
            <tbody>
    `;

    toExport.forEach(item => {
        // --- LÓGICA DE CORREÇÃO DO NÚMERO (13 DÍGITOS) ---
        let phone = (item.Telefone || "").toString().replace(/\D/g, "");

        // Se começa com 55 e não tem 13 dígitos, injeta o 9 após o 4º dígito (DDI + DDD)
        if (phone.startsWith("55") && phone.length !== 13) {
            const ddi_ddd = phone.substring(0, 4); 
            const resto = phone.substring(4);      
            phone = ddi_ddd + "9" + resto;         
        }
        // ------------------------------------------------

        table += `
            <tr>
                <td>${item.Nome || '-'}</td>
                <td style="mso-number-format:'@'">${phone || '-'}</td>
                <td style="mso-number-format:'@'">${item.CPF || '-'}</td>
                <td>${item.Email || '-'}</td>
                <td>${item.Curso || '-'}</td>
                <td>${item.TotalAberto || '-'}</td>
                <td>${item.Vencimento || '-'}</td>
                <td>${item.diasAtrasoCalculado || '-'}</td>
            </tr>
        `;
    });

    table += `</tbody></table></body></html>`;

    // 3. Download do Arquivo .xls
    const blob = new Blob([table], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    
    a.href = url;
    a.download = `Mailing_Juridico_Pendentes_3h_${hoje}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};