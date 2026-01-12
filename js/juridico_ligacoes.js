// js/juridico_ligacoes.js
import { db, auth } from "./firebase.js";
import {
  collection, getDocs, query, orderBy, updateDoc, doc, arrayUnion, deleteDoc, where, writeBatch, deleteField, addDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { parseDateBR, formatDateUTC, mapStatusToLabel } from "./utils.js";

export const JURIDICO_COLLECTION = 'juridico_ligacoes';
window.groupedJuridicoCache = {};
let currentGroupedJuridico = null;
window.juridicoList = [];

// HELPER: PEGAR USUÁRIO ATUAL (Consolidado)
function getCurrentEmail() {
  return auth.currentUser?.email || window.currentUser?.email || 'Sistema';
}

// 1. CARREGAMENTO E AGRUPAMENTO (46 a 59 DIAS)
export async function loadJuridicoLigacoes() {
  const container = document.getElementById('juridico-ligacoes-list');
  if (container) container.innerHTML = '<div class="loader"></div>';

  try {
    const q = query(collection(db, JURIDICO_COLLECTION), where("Status", "!=", "Pago"), orderBy("Status"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    const rawList = [];
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    snap.forEach(s => {
        let item = { id: s.id, ...s.data() };
        if (item.Vencimento) {
            const dataVenc = parseDateBR(item.Vencimento);
            if (dataVenc) {
                dataVenc.setHours(0, 0, 0, 0);
                // Cálculo preciso de dias de atraso
                item.diasAtrasoCalculado = Math.ceil((hoje - dataVenc) / (1000 * 60 * 60 * 24));
            }
        }
        rawList.push(item);
    });

    // Filtro da Regra de Negócio Jurídica
    const filtered = rawList.filter(item => item.diasAtrasoCalculado >= 46 && item.diasAtrasoCalculado < 60);

    // Lógica de Agrupamento por CPF/Email/Nome
    const groupedMap = {};
    filtered.forEach(item => {
        const key = item.CPF || item.Email || item.Nome;
        if (!groupedMap[key]) {
            groupedMap[key] = {
                ...item,
                listaCursos: [{ id: item.id, nome: item.Curso, valor: item.ValorParcela, total: item.TotalAberto, venc: item.Vencimento }],
                todosIds: [item.id]
            };
        } else {
            groupedMap[key].listaCursos.push({ id: item.id, nome: item.Curso, valor: item.ValorParcela, total: item.TotalAberto, venc: item.Vencimento });
            groupedMap[key].todosIds.push(item.id);
            if ((item.diasAtrasoCalculado || 0) > (groupedMap[key].diasAtrasoCalculado || 0)) {
                groupedMap[key].diasAtrasoCalculado = item.diasAtrasoCalculado;
            }
            // Sincroniza a verificação mais recente do grupo para o check azul
            if (item.UltimaVerificacao) {
                const dItem = item.UltimaVerificacao.toDate ? item.UltimaVerificacao.toDate() : new Date(item.UltimaVerificacao);
                const dAtual = groupedMap[key].UltimaVerificacao ? (groupedMap[key].UltimaVerificacao.toDate ? groupedMap[key].UltimaVerificacao.toDate() : new Date(groupedMap[key].UltimaVerificacao)) : new Date(0);
                if (dItem > dAtual) groupedMap[key].UltimaVerificacao = item.UltimaVerificacao;
            }
        }
    });

    window.groupedJuridicoCache = groupedMap;
    const finalData = Object.values(groupedMap).sort((a, b) => (a.diasAtrasoCalculado || 0) - (b.diasAtrasoCalculado || 0));
    
    window.juridicoList = finalData; // Mantém para busca local

    if (document.getElementById('total-juridico-count')) {
        document.getElementById('total-juridico-count').textContent = finalData.length;
    }

    renderJuridicoList(finalData);
  } catch (err) { console.error("Erro Jurídico:", err); }
}
window.loadJuridicoLigacoes = loadJuridicoLigacoes;

// 2. RENDERIZAÇÃO DOS CARDS (ATUALIZADO)
export function renderJuridicoList(data) {
    const container = document.getElementById('juridico-ligacoes-list');
    if (!container) return;
    container.innerHTML = '';

    data.forEach(aluno => {
        const keyParaBotao = (aluno.CPF || aluno.Email || aluno.Nome).replace(/'/g, "\\'");
        
        const rawTag = (aluno.StatusExtra && aluno.StatusExtra.tipo) 
            ? aluno.StatusExtra.tipo 
            : (typeof aluno.StatusExtra === 'string' ? aluno.StatusExtra : null);

        let badgeHTML = '';
        if (rawTag) {
            let badgeClass = 'badge-default';
            let icon = 'fa-tag';
            let label = mapStatusToLabel(rawTag);

            if (rawTag.includes('negociacao')) { badgeClass = 'badge-negociacao'; icon = 'fa-comments-dollar'; }
            else if (rawTag.includes('enviado')) { badgeClass = 'badge-enviado'; icon = 'fa-paper-plane'; }
            else if (rawTag.includes('agendado')) { badgeClass = 'badge-agendado'; icon = 'fa-clock'; }

            badgeHTML = `<span class="status-badge ${badgeClass}"><i class="fas ${icon}"></i> ${label}</span>`;
        }

        let checkHTML = '';
        if (aluno.UltimaVerificacao) {
            const dataVerif = aluno.UltimaVerificacao.toDate ? aluno.UltimaVerificacao.toDate() : new Date(aluno.UltimaVerificacao);
            const diffHoras = (new Date() - dataVerif) / (1000 * 60 * 60);
            if (diffHoras < 3) {
                checkHTML = `<div class="card-verified-badge" title="Verificado recentemente"><i class="fas fa-check"></i></div>`;
            }
        }

        const cursosHTML = aluno.listaCursos.map(c => `
            <div class="mini-course-card" style="margin-bottom: 4px; padding: 6px 10px;">
                <div>
                    <span class="course-info-main" style="font-size: 12px;">${c.nome}</span>
                    <span class="course-info-sub" style="display:block; font-size: 10px;">Vencimento: ${c.venc}</span>
                </div>
            </div>
        `).join('');

        const card = document.createElement('div');
        card.className = `juridico-card status-${String(rawTag || "nenhum").toLowerCase()}`;
        
        // NOVO LAYOUT: Flexbox para separar conteúdo e botões
        card.innerHTML = `
            ${checkHTML}
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 15px;">
                
                <div class="card-info" style="flex: 1;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                        <h3 style="color: #1e293b; font-size: 1.1rem; font-weight: 800; margin: 0;">${aluno.Nome}</h3>
                        ${badgeHTML}
                    </div>
                    
                    <div class="courses-wrapper">${cursosHTML}</div>
                    
                    <div style="margin-top: 8px; display: flex; gap: 15px; font-size: 12px; color: #475569;">
                        <span>Atraso: <strong style="color:#e53e3e;">${aluno.diasAtrasoCalculado} dias</strong></span>
                        <span>📞 ${aluno.LigaEtapa || 0}</span>
                    </div>
                    
                    <p style="color: #d9534f; font-size: 10px; font-weight: 600; margin-top: 5px; margin-bottom: 0;">
                        <i class="fas fa-exclamation-triangle"></i> 1ª Jurídica em: ${formatDateUTC(aluno.Data1Jur)}
                    </p>
                </div>

                <div class="card-side-actions" style="display: flex; flex-direction: column; gap: 10px; align-items: flex-end; min-width: 100px;">
                    <button class="btn-actions-open" style="width: 100%; padding: 8px 12px; font-size: 13px;" onclick="window.openActionsModalJuridicoByKey('${keyParaBotao}')">
                        <i class="fas fa-bolt"></i> Ações
                    </button>
                    <button class="icon-btn trash-icon admin-only" style="opacity: 0.2; background: none; border: none; font-size: 16px; cursor: pointer;" onclick="window.archiveJuridico('${aluno.id}')">
                        🗑️
                    </button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// 3. ATENDIMENTO COM LOG (IGUAL AO COBRANÇA)
window.AtendimentoJuridico = async function() {
    if (!currentGroupedJuridico) return;

    const { value: desfecho } = await Swal.fire({
        title: 'Desfecho do Atendimento',
        input: 'textarea',
        inputPlaceholder: 'Resuma o que o aluno disse...',
        showCancelButton: true,
        confirmButtonText: 'Salvar Log',
        inputValidator: (value) => !value && 'Você precisa descrever o atendimento!'
    });

    if (!desfecho) return;

    const batch = writeBatch(db);
    const user = getCurrentEmail();
    const agora = new Date();
    const novaEtapa = (currentGroupedJuridico.LigaEtapa || 0) + 1;
    
    // Log formatado para P4 (Observações)
    const logFormatado = `${agora.toLocaleString('pt-BR', {day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit'})} - ${desfecho}`;
    const p4Antigo = (currentGroupedJuridico.Propostas && currentGroupedJuridico.Propostas.p4) ? currentGroupedJuridico.Propostas.p4 : "";
    const novoP4 = `${logFormatado}${p4Antigo ? '\n' + p4Antigo : ''}`;

    currentGroupedJuridico.todosIds.forEach(id => {
        batch.update(doc(db, JURIDICO_COLLECTION, id), {
            LigaEtapa: novaEtapa,
            UltimaAcao: agora,
            UltimoResponsavel: user,
            "Propostas.p4": novoP4,
            HistoricoLogs: arrayUnion({ tipo: 'atendimento', detalhe: desfecho, responsavel: user, timestamp: agora.toISOString() })
        });
    });

    await batch.commit();
    currentGroupedJuridico.LigaEtapa = novaEtapa;
    if(!currentGroupedJuridico.Propostas) currentGroupedJuridico.Propostas = {};
    currentGroupedJuridico.Propostas.p4 = novoP4;
    
    if(document.getElementById('jur-prop-4')) document.getElementById('jur-prop-4').value = novoP4;
    updateJuridicoStageButtons(currentGroupedJuridico);
    loadJuridicoLigacoes();
    Swal.fire('Registrado!', 'Atendimento salvo em todos os cursos.', 'success');
};

// LIGAÇÃO REALIZADA

window.nextCallStageJuridico = async function() {
    if (!currentGroupedJuridico) return;
    const batch = writeBatch(db);
    const agora = new Date();
    const user = getCurrentEmail();
    const novaEtapa = (currentGroupedJuridico.LigaEtapa || 0) + 1;

    currentGroupedJuridico.todosIds.forEach(id => {
        batch.update(doc(db, JURIDICO_COLLECTION, id), {
            LigaEtapa: novaEtapa,
            UltimaAcao: agora,
            UltimoResponsavel: user,
            HistoricoLogs: arrayUnion({ 
                tipo: 'tentativa_ligacao', 
                etapa: novaEtapa, 
                responsavel: user, 
                timestamp: agora.toISOString() 
            })
        });
    });

    await batch.commit();
    currentGroupedJuridico.LigaEtapa = novaEtapa;
    updateJuridicoStageButtons(currentGroupedJuridico);
    loadJuridicoLigacoes();
};

// 4. VERIFICADO (CHECK DE 4H)
window.VerificadoJuridico = async function() {
    if (!currentGroupedJuridico) return;
    const batch = writeBatch(db);
    const agora = new Date(); // Data atual para o check de 4h
    const user = auth.currentUser?.email || "Sistema";
    const novaEtapa = (currentGroupedJuridico.TemplateEtapa || 0) + 1;

    currentGroupedJuridico.todosIds.forEach(id => {
        batch.update(doc(db, JURIDICO_COLLECTION, id), {
            TemplateEtapa: novaEtapa,
            UltimaVerificacao: agora, // Campo usado para o check
            UltimaAcao: agora,
            UltimoResponsavel: user
        });
    });

    try {
        await batch.commit();
        
        // VITAL: Atualiza o objeto local antes de recarregar
        currentGroupedJuridico.UltimaVerificacao = agora;
        
        // Recarrega a lista para processar o ícone no renderJuridicoList
        await loadJuridicoLigacoes(); 
        
        if(window.showToast) window.showToast("Verificação registrada!");
    } catch (err) {
        console.error("Erro ao verificar:", err);
    }
};

// 5. SALVAR TAG PARA TODOS (BATCH)
window.saveExtraStatusJuridico = async function() {
  if (!currentGroupedJuridico) return;
  const val = document.getElementById('juridico-extra-status-select').value;
  const user = getCurrentEmail();
  const batch = writeBatch(db);

  currentGroupedJuridico.todosIds.forEach(id => {
    batch.update(doc(db, JURIDICO_COLLECTION, id), {
        StatusExtra: val ? { tipo: val, atualizadoEm: new Date(), por: user } : deleteField(),
        DataTag: val ? new Date() : deleteField()
    });
  });

  await batch.commit();
  loadJuridicoLigacoes();
  if (window.showToast) window.showToast("Status atualizado!");
};

// 6. MODAL E PROPOSTAS
window.openActionsModalJuridicoByKey = function(key) {
    const aluno = window.groupedJuridicoCache[key];
    if (aluno) openActionsModalJuridico(aluno);
};

export function openActionsModalJuridico(aluno) {
    currentGroupedJuridico = aluno;
    document.getElementById('juridico-actions-student-name').textContent = aluno.Nome;

    // Cabeçalho de Dados Pessoais
    document.getElementById('juridico-actions-student-details').innerHTML = `
        <div style="background: #f1f5f9; border-radius: 10px; padding: 15px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px;">
            <p style="margin:0; font-size:13px;"><strong>Email:</strong> ${aluno.Email}</p>
            <p style="margin:0; font-size:13px;"><strong>Telefone:</strong> ${aluno.Telefone}</p>
            <p style="margin:0; font-size:13px;"><strong>CPF:</strong> ${aluno.CPF}</p>
            <p style="margin:0; font-size:13px;"><strong>Cursos:</strong> ${aluno.listaCursos.length}</p>
        </div>
        
        <h4 style="font-size: 12px; color: #6A1B9A; text-transform: uppercase; margin-bottom: 10px;">Cursos Detalhados</h4>
        
        ${(aluno.listaCursos || []).map(curso => `
          <div class="mini-course-card" style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 5px solid #6A1B9A; padding: 12px 15px; margin-bottom: 10px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.02); display: flex; justify-content: space-between; align-items: center;">
              <div>
                  <span style="font-size:14px; display:block; color:#1e293b; font-weight:700;">${curso.nome}</span>
                  <span style="font-size:11px; color:#64748b;">Vencimento: ${curso.venc || '-'}</span>
              </div>
              
              <div style="text-align: right; display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 10px; color:#64748b; text-transform: uppercase; white-space: nowrap;">Dívida Total:</span>
                  <span style="font-size:15px; color:#c53030; font-weight: 800; white-space: nowrap;">${curso.total || 'R$ 0,00'}</span>
              </div>
          </div>
      `).join('')}
    `;
    
    // Atualiza pílulas de seleção de curso para baixa
    const checkboxContainer = document.getElementById('juridico-course-checkbox-list');
    if (checkboxContainer) {
        checkboxContainer.innerHTML = aluno.listaCursos.map(c => `
            <div class="pill-checkbox-item">
                <input type="checkbox" class="jur-payment-check" value="${c.id}" id="jur-chk-${c.id}">
                <label for="jur-chk-${c.id}">${c.nome}</label>
            </div>
        `).join('');
    }

    // Carrega Propostas e Status...
    const sel = document.getElementById('juridico-extra-status-select');
    if (sel) {
        // CORREÇÃO: Garante que o select encontre o valor correto, seja objeto ou string
        const valorTag = (aluno.StatusExtra && aluno.StatusExtra.tipo) ? aluno.StatusExtra.tipo : (typeof aluno.StatusExtra === 'string' ? aluno.StatusExtra : '');
        sel.value = valorTag;
    }
    
    for (let i=1; i<=4; i++) {
        const el = document.getElementById(`jur-prop-${i}`);
        if (el) el.value = (aluno.Propostas && aluno.Propostas[`p${i}`]) ? aluno.Propostas[`p${i}`] : '';
    }

    updateJuridicoStageButtons(aluno);
    document.getElementById('actions-modal-juridico').classList.remove('modal-hidden');
    document.getElementById('actions-modal-juridico').style.display = 'flex';
}
window.openActionsModalJuridico = openActionsModalJuridico;

export function closeActionsModalJuridico() {
  const overlay = document.getElementById('actions-modal-juridico');
  if (overlay) { overlay.classList.add('modal-hidden'); overlay.style.display = 'none'; }
}
window.closeActionsModalJuridico = closeActionsModalJuridico;

window.saveProposalJuridico = async function(index) {
  if (!currentGroupedJuridico) return;
  const text = document.getElementById(`jur-prop-${index}`)?.value || '';
  const batch = writeBatch(db);

  currentGroupedJuridico.todosIds.forEach(id => {
    const updateData = {};
    updateData[`Propostas.p${index}`] = text;
    batch.update(doc(db, JURIDICO_COLLECTION, id), updateData);
  });
  await batch.commit();
};

export function updateJuridicoStageButtons(item) {
  const callBtn = document.getElementById('juridico-btn-next-call');
  const tempBtn = document.getElementById('juridico-btn-next-template');
  const info = document.getElementById('juridico-last-action-info');

  if (callBtn) callBtn.textContent = `📞 TENTATIVA #${(item.LigaEtapa || 0) + 1}`;
  if (tempBtn) tempBtn.textContent = `✅ VERIFICADO #${(item.TemplateEtapa || 0) + 1}`;

  if (info && item.UltimaAcao) {
    const d = item.UltimaAcao.toDate ? item.UltimaAcao.toDate() : new Date(item.UltimaAcao);
    info.innerHTML = `Última: ${d.toLocaleString('pt-BR')}<br><small>Por: ${item.UltimoResponsavel || 'Sistema'}</small>`;
  }
}

// 7. PAGAMENTO E ARQUIVO
window.registerPaymentJuridico = async function() {
  if (!currentGroupedJuridico) return;
  const checkboxes = document.querySelectorAll('.jur-payment-check:checked');
  if (checkboxes.length === 0) return Swal.fire('Atenção', 'Selecione um curso.', 'warning');

  const dateVal = document.getElementById('juridico-payment-date')?.value;
  const origin = document.getElementById('juridico-payment-origin')?.value;
  if (!dateVal || !origin) return Swal.fire('Ops!', 'Preencha data e origem.', 'warning');

  if (confirm('Confirmar baixa?')) {
      const batch = writeBatch(db);
      checkboxes.forEach(cb => {
          batch.update(doc(db, JURIDICO_COLLECTION, cb.value), {
              Status: 'Pago', DataPagamento: new Date(dateVal), OrigemPagamento: origin, BaixadoPor: getCurrentEmail()
          });
      });
      await batch.commit();
      closeActionsModalJuridico();
      loadJuridicoLigacoes();
  }
};

export async function archiveJuridico(id) {
  const confirmAction = async () => {
      if (typeof Swal !== 'undefined') {
          const res = await Swal.fire({
              title: 'Tem certeza?',
              text: "O registro será removido permanentemente.",
              icon: 'warning',
              showCancelButton: true,
              confirmButtonColor: '#d33',
              confirmButtonText: 'Sim, excluir!'
          });
          return res.isConfirmed;
      }
      return confirm('Remover registro permanentemente?');
  };

  if (!(await confirmAction())) return;

  try {
    await deleteDoc(doc(db, JURIDICO_COLLECTION, id));
    loadJuridicoLigacoes(); // Recarrega a lista após excluir
    if(typeof Swal !== 'undefined') Swal.fire('Excluído!', '', 'success');
  } catch (err) {
    console.error(err);
    alert('Erro ao excluir.');
  }
}
window.archiveJuridico = archiveJuridico;

// 8. BUSCA E EXPORTAÇÃO
window.filterJuridicoList = function() {
    const term = document.getElementById('juridico-ligacoes-search').value.toLowerCase();
    const filtered = window.juridicoList.filter(item => 
        (item.Nome || "").toLowerCase().includes(term) || (item.CPF || "").includes(term)
    );
    renderJuridicoList(filtered);
};

window.exportJuridicoNoInteraction = function() {
    if (!window.juridicoList || window.juridicoList.length === 0) {
        return Swal.fire("Erro", "A lista jurídica está vazia.", "error");
    }

    const agora = Date.now();
    const tresHorasEmMs = 3 * 60 * 60 * 1000;
    const limite = agora - tresHorasEmMs;

    // 1. Lógica de Filtragem
    const filteredList = window.juridicoList.filter(item => {
        // Exclui quem tem TAG (StatusExtra)
        if (item.StatusExtra) return false;

        // Verifica o tempo da última ação
        let interactionTime = 0;
        if (item.UltimaAcao) {
            interactionTime = item.UltimaAcao.toMillis ? item.UltimaAcao.toMillis() : new Date(item.UltimaAcao).getTime();
        }

        // Verifica se a última interação foi um "atendimento"
        const logs = item.HistoricoLogs || [];
        const ultimoLog = logs.length > 0 ? logs[logs.length - 1] : null;
        const foiAtendimento = ultimoLog && ultimoLog.tipo === 'atendimento';

        // Exclui se foi atendimento dentro das últimas 3 horas
        if (foiAtendimento && interactionTime > limite) return false;

        return true;
    });

    if (filteredList.length === 0) {
        return Swal.fire("Atenção", "Nenhum registro pendente após aplicar os filtros (Sem TAG e sem atendimento recente).", "info");
    }

    // 2. Formatação dos Dados para as Colunas Solicitadas
    const dataToExport = filteredList.map(item => {
        const nomeCompleto = item.Nome || item.nome || "Não informado";
        const primeiroNome = nomeCompleto.split(' ')[0];
        
        // Lógica de Formatação de Telefone
        let tel = (item.Telefone || "").toString().replace(/\D/g, '');
        if (tel.startsWith('55')) {
            // Se tiver 12 dígitos (falta o 9), adiciona o 9 na 5ª posição
            if (tel.length === 12) {
                tel = tel.slice(0, 4) + '9' + tel.slice(4);
            }
        }

        return {
            "Primeiro nome": primeiroNome,
            "Nome": nomeCompleto,
            "Email": item.Email || item.email || "N/A",
            "Telefone": tel,
            "Valor total": item.TotalAberto || 0
        };
    });

    // 3. Geração do Arquivo XLSX
    try {
        const worksheet = XLSX.utils.json_to_sheet(dataToExport);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Cobrança Jurídica");

        // Nome do arquivo com data
        const dataArquivo = new Date().toLocaleDateString().replace(/\//g, '-');
        XLSX.writeFile(workbook, `Export_Juridico_${dataArquivo}.xlsx`);

        Swal.fire("Sucesso", `Exportado ${filteredList.length} registros.`, "success");
    } catch (error) {
        console.error("Erro na exportação:", error);
        Swal.fire("Erro", "Falha ao gerar o arquivo Excel.", "error");
    }
};

// 9. IMPORTAÇÃO
window.openImportModalJuridico = () => document.getElementById('import-modal-juridico').classList.remove('modal-hidden');
window.closeImportModalJuridico = () => document.getElementById('import-modal-juridico').classList.add('modal-hidden');

window.processImportJuridico = async function() {
  const rawData = document.getElementById('import-data-juridico')?.value || '';
  if (!rawData) return Swal.fire('Ops!', 'Cole os dados antes de processar.', 'warning');

  const lines = rawData.trim().split('\n');
  let successCount = 0;

  // Feedback visual de carregamento
  Swal.fire({
      title: 'Importando...',
      html: 'Aguarde enquanto processamos os registros.',
      didOpen: () => Swal.showLoading()
  });

  try {
    const promises = lines.map(async (row) => {
      const cols = row.split('\t').map(c => c.trim());
      if (cols.length < 9) return; // Garante que a linha tenha as colunas mínimas

      const newItem = {
        Curso: cols[0] || '',
        Nome: cols[1] || '',
        Email: cols[2] || '',
        CPF: cols[3] || '',
        Telefone: cols[4] || '',
        ValorParcela: cols[5] || '',
        TotalAberto: cols[6] || '',
        Vencimento: cols[7] || '', // Usado para cálculo de atraso
        Data1Jur: parseDateBR(cols[8]), // Formata a data para o Firebase
        Status: 'Ativo',
        LigaEtapa: 0,
        TemplateEtapa: 0,
        createdAt: new Date(),
        createdBy: auth.currentUser?.email || 'Sistema'
      };

      await addDoc(collection(db, JURIDICO_COLLECTION), newItem);
      successCount++;
    });

    await Promise.all(promises);

    // Limpa e fecha o modal
    document.getElementById('import-data-juridico').value = '';
    window.closeImportModalJuridico();

    Swal.fire('Sucesso!', `${successCount} alunos importados com sucesso.`, 'success');
    
    // Recarrega a lista para mostrar os novos dados
    loadJuridicoLigacoes();

  } catch (err) {
    console.error("Erro na importação:", err);
    Swal.fire('Erro!', 'Ocorreu um problema ao salvar os dados no banco.', 'error');
  }
};