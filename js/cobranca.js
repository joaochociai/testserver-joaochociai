// js/cobranca.js
import { db, auth } from './firebase.js'; 
import {
  collection, getDocs, query, orderBy, addDoc,
  updateDoc, doc, arrayUnion, deleteDoc, where, deleteField, writeBatch, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { formatDateUTC, parseDateBR, mapStatusToLabel } from './utils.js';

export const COBRANCA_COLLECTION = 'controle_3_cobranca';
window.COBRANCA_COLLECTION = COBRANCA_COLLECTION; 

window.groupedCobrancaCache = window.groupedCobrancaCache || {};
let currentGroupedStudent = null;

// Cache local
window.cobrancaList = [];
let currentActionStudentId = null; 

// --- HELPER: PEGAR USUÁRIO ATUAL ---
function getCurrentUserEmail() {
    if (auth.currentUser) return auth.currentUser.email;
    return window.currentUser?.email || "Sistema";
}

// -------------------------
// 1. CARREGAR E FILTRAR (LÓGICA NOVA)
// -------------------------
export async function loadCobrancaData() {
  const container = document.getElementById('cobranca-list');
  if (container) container.innerHTML = '<div class="loader"></div>';

  try {
    const q = query(collection(db, COBRANCA_COLLECTION), where("Status", "!=", "Pago"), orderBy("Status"), orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);

    const rawList = [];
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0); 

    querySnapshot.forEach((docSnap) => {
        // Apenas montamos o objeto aluno, sem a lógica de "Faxineiro"
        let aluno = { id: docSnap.id, ...docSnap.data() };
        rawList.push(aluno);
    });

    // --- FILTRO: JANELA DE 31 A 45 DIAS ---
    window.cobrancaList = rawList.filter(aluno => {
        if (aluno.Status === 'Pago') return false;

        if (!aluno.Vencimento) return true;

        const dataVenc = parseDateBR(aluno.Vencimento); 
        if (!dataVenc) return true; 
        
        dataVenc.setHours(0, 0, 0, 0);
        
        const diffTime = hoje - dataVenc;
        const diasAtraso = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        aluno.diasAtrasoCalculado = diasAtraso;

        // REGRA: Mostrar apenas entre 31 e 45 dias
        return diasAtraso >= 31 && diasAtraso < 45;
    });

    const kpiEl = document.getElementById('total-active-count');
    if (kpiEl) kpiEl.textContent = window.cobrancaList.length;

    renderCobrancaList(window.cobrancaList);

  } catch (error) {
    console.error("Erro ao carregar cobrança:", error);
    if (container) container.innerHTML = '<p>Erro ao carregar dados.</p>';
  }
}
window.loadCobrancaData = loadCobrancaData;

// -------------------------
// 2. RENDERIZAR LISTA
// -------------------------
export function filterCobranca() {
    const term = document.getElementById('cobranca-search').value.toLowerCase();
    if (!term) {
        renderCobrancaList(window.cobrancaList);
        return;
    }
    const filtered = window.cobrancaList.filter(aluno => 
        (aluno.Nome && aluno.Nome.toLowerCase().includes(term)) ||
        (aluno.CPF && aluno.CPF.includes(term)) ||
        (aluno.Email && aluno.Email.toLowerCase().includes(term))
    );
    renderCobrancaList(filtered);
}
window.filterCobranca = filterCobranca;

window.openActionsModalByKey = function(key) {
    const aluno = window.groupedCobrancaCache[key];
    if (aluno) {
        // Certifique-se que sua openActionsModal aceite o objeto
        openActionsModal(aluno); 
    } else {
        console.error("Erro: Aluno não encontrado no cache.");
    }
};

export function renderCobrancaList(data) {
  const container = document.getElementById('cobranca-list');
  if (!container) return;
  container.innerHTML = '';

  if (!data || data.length === 0) {
    container.innerHTML = '<p class="empty-msg">Nenhum aluno na fase de 3ª Cobrança!</p>';
    return;
  }

  const groupedMap = {};
  data.forEach(item => {
    const key = item.CPF || item.Email || item.Nome;
    if (!groupedMap[key]) {
      groupedMap[key] = {
        ...item,
        listaCursos: [{ id: item.id, nome: item.Curso, valor: item.Valor, vencimento: item.Vencimento }],
        todosIds: [item.id]
      };
    } else {
      groupedMap[key].listaCursos.push({ id: item.id, nome: item.Curso, valor: item.Valor, vencimento: item.Vencimento });
      groupedMap[key].todosIds.push(item.id);
      
      // Sincroniza o maior atraso para o badge principal
      if ((item.diasAtrasoCalculado || 0) > (groupedMap[key].diasAtrasoCalculado || 0)) {
          groupedMap[key].diasAtrasoCalculado = item.diasAtrasoCalculado;
          groupedMap[key].Data1Jur = item.Data1Jur;
          groupedMap[key].DataTag = item.DataTag;
          groupedMap[key].StatusExtra = item.StatusExtra;
      }

      // 🔥 AJUSTE DE SEGURANÇA: Sincroniza a verificação MAIS RECENTE do grupo
      // Isso garante que o check apareça se qualquer curso foi verificado
      if (item.UltimaVerificacao) {
          const dataItem = item.UltimaVerificacao.toDate ? item.UltimaVerificacao.toDate() : new Date(item.UltimaVerificacao);
          const dataAtual = groupedMap[key].UltimaVerificacao ? (groupedMap[key].UltimaVerificacao.toDate ? groupedMap[key].UltimaVerificacao.toDate() : new Date(groupedMap[key].UltimaVerificacao)) : new Date(0);
          if (dataItem > dataAtual) {
              groupedMap[key].UltimaVerificacao = item.UltimaVerificacao;
          }
      }
    }
  });

  window.groupedCobrancaCache = groupedMap; 
  const sortedData = Object.values(groupedMap).sort((a, b) => (a.diasAtrasoCalculado || 0) - (b.diasAtrasoCalculado || 0));

  sortedData.forEach(aluno => {
      const keyParaBotao = (aluno.CPF || aluno.Email || aluno.Nome).replace(/'/g, "\\'");
      const tagNome = aluno.StatusExtra?.tipo || aluno.StatusExtra || null;
      
      // ============================================================
      // 🕒 LÓGICA DO CHECK ESTILIZADO (VERIFICADO < 2H)
      // ============================================================
      let checkVerificadoHTML = '';
      if (aluno.UltimaVerificacao) {
          const dataVerif = aluno.UltimaVerificacao.toDate ? aluno.UltimaVerificacao.toDate() : new Date(aluno.UltimaVerificacao);
          const diffMs = new Date() - dataVerif;
          const diffHoras = diffMs / (1000 * 60 * 60);

          if (diffHoras < 4) {
              checkVerificadoHTML = `
                  <div class="card-verified-badge" title="Verificado recentemente">
                      <i class="fas fa-check"></i>
                  </div>`;
          }
      }

      // Badge de dias (Pílula amarela)
      const diasLabel = aluno.diasAtrasoCalculado 
          ? `<span style="background:#fff3cd; color:#856404; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:bold; margin-left:8px; border: 1px solid #ffeeba;">${aluno.diasAtrasoCalculado} dias</span>`
          : '';

      const dataLimite = aluno.Data1Jur ? (typeof formatDateUTC === 'function' ? formatDateUTC(aluno.Data1Jur) : aluno.Data1Jur) : 'N/A';

      const cursosHTML = aluno.listaCursos.map(c => `
        <div style="border-left: 3px solid #007bff; padding-left: 10px; margin-bottom: 6px; background: #fdfdfd; padding: 5px 10px; border-radius: 4px;">
           <span style="font-size:13px; display:block; color: #333;"><strong>Curso:</strong> ${c.nome || '-'}</span>
           <span style="font-size:12px; color:#666;">Valor: ${c.valor || '-'} | Venc: ${c.vencimento || '-'}</span>
        </div>
      `).join('');

      const card = document.createElement('div');
      const safeClass = String(tagNome || "nenhum").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s_]+/g, '-').toLowerCase();
      card.className = `cobranca-card status-${safeClass}`;
  
      card.innerHTML = `
        ${checkVerificadoHTML} <div class="card-info">
          <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom: 10px;">
             <h3 style="margin:0; font-size: 1.1rem; padding-right: 35px;">${aluno.Nome}</h3>
             ${aluno.listaCursos.length > 1 ? `<span style="background:#e7f1ff; color:#007bff; font-size:10px; padding:2px 6px; border-radius:10px; font-weight:bold;">${aluno.listaCursos.length} CURSOS</span>` : ''}
          </div>
          
          <div class="courses-list-container" style="margin-bottom: 12px;">
            ${cursosHTML}
          </div>

          <p style="margin:8px 0; font-size:13px; color:#444; display: flex; align-items: center;">
              📞 Lig: <strong>${aluno.LigaEtapa || 0}</strong> | 💬 Temp: <strong>${aluno.TemplateEtapa || 0}</strong> ${diasLabel}
          </p>
          <p class="limit-date" style="margin: 5px 0; color: #d9534f; font-weight: 500;">⚠️ Jurídico em: ${dataLimite}</p>
          ${tagNome ? `<p class="extra-status" style="margin-top: 8px;">${typeof mapStatusToLabel === 'function' ? mapStatusToLabel(tagNome) : tagNome}</p>` : ''}
        </div>
        <div class="card-actions" style="display: flex; flex-direction: column; gap: 10px; align-items: flex-end;">
          <button class="btn-actions-open" onclick="window.openActionsModalByKey('${keyParaBotao}')">⚡ Ações</button>
          <button class="icon-btn trash-icon admin-only" style="opacity: 0.3;" onclick="window.archiveStudent('${aluno.id}')">🗑️</button>
        </div>
      `;
      container.appendChild(card);
  });
}
window.renderCobrancaList = renderCobrancaList;

// -------------------------
// 3. MODAL DE IMPORTAÇÃO
// -------------------------
export function openImportModal() {
    const overlay = document.getElementById('import-modal-overlay');
    if(overlay) {
        overlay.classList.remove('modal-hidden');
        overlay.style.display = 'flex';
    }
}
window.openImportModal = openImportModal;

export function closeImportModal() {
    const overlay = document.getElementById('import-modal-overlay');
    if(overlay) overlay.classList.add('modal-hidden');
}
window.closeImportModal = closeImportModal;

export async function processImportRaw(rawData) {
  if (!rawData) return 0;
  const lines = rawData.trim().split('\n');
  let successCount = 0;

  const promises = lines.map(async (row) => {
    const cols = row.split('\t');
    if (cols.length < 3) return;

    const data3Cob = parseDateBR(cols[8]?.trim());
    const data1Jur = parseDateBR(cols[9]?.trim());

    const alunoData = {
      Nome: cols[0]?.trim() || '',
      Email: cols[1]?.trim() || '',
      CPF: cols[2]?.trim() || '',
      Telefone: cols[3]?.trim() || '',
      Curso: cols[4]?.trim() || '',
      FormaPag: cols[5]?.trim() || '',
      Valor: cols[6]?.trim() || '',
      Vencimento: cols[7]?.trim() || '',
      Data3Cob: data3Cob || new Date(),
      Data1Jur: data1Jur || new Date(),
      LigaEtapa: 0,
      TemplateEtapa: 0,
      Status: 'Ativo',
      createdAt: new Date()
    };

    await addDoc(collection(db, COBRANCA_COLLECTION), alunoData);
    successCount++;
  });

  await Promise.all(promises);
  return successCount;
}

window.processImport = async function () {
  const raw = document.getElementById('import-data')?.value || '';
  if (!raw) return Swal.fire('Ops!', 'Cole os dados primeiro.', 'warning');
  
  // Fecha o modal de input para focar no loading
  window.closeImportModal();

  // Loading
  Swal.fire({
      title: 'Importando...',
      html: 'Processando linhas do Excel.',
      didOpen: () => Swal.showLoading()
  });
  
  try {
    const count = await processImportRaw(raw);
    
    // Sucesso com detalhes
    Swal.fire({
        title: 'Importação Concluída!',
        text: `${count} novos alunos foram adicionados.`,
        icon: 'success'
    });
    
    loadCobrancaData();
  } catch (err) {
    console.error(err);
    Swal.fire('Erro na Importação', 'Verifique o formato das colunas.', 'error');
  }
};

async function salvarTagParaTodosOsCursos(alunoAgrupado, novaTag) {
  const batch = writeBatch(db);
  const userEmail = getCurrentUserEmail();
  const ids = alunoAgrupado.todosIds || [alunoAgrupado.id];

  ids.forEach(docId => {
    const docRef = doc(db, COBRANCA_COLLECTION, docId);
    
    if (novaTag) {
      batch.update(docRef, {
        StatusExtra: { tipo: novaTag, atualizadoEm: new Date(), por: userEmail },
        UltimoResponsavel: userEmail,
        DataTag: new Date(),
        HistoricoLogs: arrayUnion({
          tipo: "tag",
          detalhe: `Tag "${novaTag}" adicionada via card agrupado`,
          responsavel: userEmail,
          timestamp: new Date().toISOString()
        })
      });
    } else {
      batch.update(docRef, {
        StatusExtra: deleteField(),
        DataTag: deleteField(),
        UltimoResponsavel: userEmail,
        HistoricoLogs: arrayUnion({
          tipo: "tag",
          detalhe: `Tag removida via card agrupado`,
          responsavel: userEmail,
          timestamp: new Date().toISOString()
        })
      });
    }
  });

  return await batch.commit();
}

// -------------------------
// 4. MODAL DE AÇÕES (DETALHES)
// -------------------------

export function openActionsModal(alunoObjeto) {
  // alunoObjeto é o objeto que vem do cache agrupado
  if (!alunoObjeto) return;

  // 1. Sincronização Global
  currentGroupedStudent = alunoObjeto;
  window.currentActionStudentId = alunoObjeto.id; 

  // 2. Preenchimento de Dados Básicos
  document.getElementById('actions-student-name').textContent = alunoObjeto.Nome;
  
  const totalCursos = alunoObjeto.listaCursos ? alunoObjeto.listaCursos.length : 0;
  
  const cursosListaHtml = (alunoObjeto.listaCursos || []).map(curso => `
    <div style="background: #f8f9fa; border-left: 3px solid var(--primary-blue); padding: 8px 12px; margin-bottom: 8px; border-radius: 4px;">
      <p style="margin:0; font-size: 14px;"><strong>Curso:</strong> ${curso.nome || '-'}</p>
      <p style="margin:0; font-size: 12px; color: #666;">Valor: ${curso.valor || '-'} | Vencimento: ${curso.vencimento || '-'}</p>
    </div>
  `).join('');

  document.getElementById('actions-student-details').innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
        <p style="margin:0;"><strong>Email:</strong> ${alunoObjeto.Email || '-'}</p>
        <p style="margin:0;"><strong>Telefone:</strong> ${alunoObjeto.Telefone || '-'}</p>
        <p style="margin:0;"><strong>CPF:</strong> ${alunoObjeto.CPF || '-'}</p>
        <p style="margin:0;"><strong>Total de Cursos:</strong> ${totalCursos}</p>
    </div>
    <div style="margin-top: 10px;">
        <p style="margin-bottom: 8px;"><strong>Detalhamento dos Contratos:</strong></p>
        ${cursosListaHtml}
    </div>
  `;

  // 3. Status Extra
  const tagAtual = alunoObjeto.StatusExtra?.tipo || alunoObjeto.StatusExtra || '';
  const select = document.getElementById("extra-status-select");
  if (select) select.value = tagAtual;

  // 4. Lista de Cursos para Pagamento
  const checkboxContainer = document.getElementById('course-checkbox-list');
  if (checkboxContainer && alunoObjeto.listaCursos) {
      checkboxContainer.innerHTML = alunoObjeto.listaCursos.map(curso => {
          const valorNumerico = curso.valor ? parseFloat(curso.valor.replace(/[^\d,.-]/g, '').replace('.', '').replace(',', '.')) : 0;
          return `
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; background: #fff; padding: 5px 10px; border-radius: 5px;">
                  <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                      <input type="checkbox" class="course-payment-check" value="${curso.id}" id="chk-${curso.id}" checked>
                      <label for="chk-${curso.id}" style="font-size: 13px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">
                          ${curso.nome}
                      </label>
                  </div>
                  <div style="display: flex; align-items: center; gap: 4px;">
                      <span style="font-size: 12px; font-weight: bold; color: #28a745;">R$</span>
                      <input type="text" class="course-payment-amount" data-id="${curso.id}" 
                             value="${valorNumerico.toLocaleString('pt-BR', {minimumFractionDigits: 2})}" 
                             style="width: 90px; padding: 3px; border: 1px solid #ccc; border-radius: 4px; text-align: right; font-weight: bold; color: #28a745;">
                  </div>
              </div>
          `;
      }).join('');
  }

  // 5. Preenche Propostas e vincula o evento de salvar
  const props = alunoObjeto.Propostas || {};
  for(let i=1; i<=4; i++) {
      const el = document.getElementById(`prop-${i}`);
      if(el) {
          el.value = props[`p${i}`] || '';
          // VINCULAMOS O SALVAMENTO AQUI (Garante que salve ao sair do campo)
          el.onblur = () => window.saveProposal(i);
      }
  }

  // 6. Atualiza botões de etapa (CORREÇÃO: Usando o nome correto alunoObjeto)
  if (typeof updateStageButtons === 'function') {
      updateStageButtons(alunoObjeto);
  }

  // 7. Atualiza cor do cabeçalho
  const modalHeader = document.querySelector('.actions-header');
  if (modalHeader) {
      modalHeader.className = 'actions-header'; 
      if(tagAtual) {
          const safe = String(tagAtual).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s_]+/g, '-').toLowerCase();
          modalHeader.classList.add(`header-status-${safe}`);
      }
  }

  // 8. Exibe o Modal
  const overlay = document.getElementById('actions-modal-overlay');
  if (overlay) {
    overlay.classList.remove('modal-hidden');
    overlay.style.display = 'flex';
  }
}
window.openActionsModal = openActionsModal;

export function closeActionsModal() {
  const overlay = document.getElementById("actions-modal-overlay");
  if (overlay) overlay.classList.add("modal-hidden");
}
window.closeActionsModal = closeActionsModal;

// -------------------------
// 5. ETAPAS (LIGAÇÃO / TEMPLATE) COM LOG
// -------------------------
export function updateStageButtons(aluno) {
  const callBtn = document.getElementById("btn-next-call");
  const tempBtn = document.getElementById("btn-next-template");
  const infoTxt = document.getElementById("last-action-info");

  // Nomes atualizados para a nova regra
  if (callBtn) callBtn.textContent = `📞 ATENDEU #${(aluno.LigaEtapa || 0) + 1}`;
  if (tempBtn) tempBtn.textContent = `✅ VERIFICADO #${(aluno.TemplateEtapa || 0) + 1}`;
  
  if (infoTxt && aluno.UltimaAcao) {
      let date;
      // TRATAMENTO ROBUSTO DE DATA
      if (aluno.UltimaAcao.toDate) date = aluno.UltimaAcao.toDate();
      else if (aluno.UltimaAcao instanceof Date) date = aluno.UltimaAcao;
      else if (typeof aluno.UltimaAcao === 'string') date = new Date(aluno.UltimaAcao);
      else date = null;

      if (date && !isNaN(date.getTime())) {
          infoTxt.innerHTML = `Última: ${date.toLocaleString('pt-BR')}<br><small>Por: ${aluno.UltimoResponsavel || 'Sistema'}</small>`;
      } else {
          infoTxt.textContent = 'Aguardando primeira ação...';
      }
  } else if (infoTxt) {
      infoTxt.textContent = 'Sem interações recentes';
  }
}
window.updateStageButtons = updateStageButtons;

export async function LigaçãoAtendida() {
    if (!currentGroupedStudent) return;

    const { value: explicacao } = await Swal.fire({
        title: 'Explicação do Atendimento',
        input: 'textarea',
        inputLabel: 'O que foi conversado com o aluno?',
        inputPlaceholder: 'Ex: Prometeu pagar amanhã...',
        showCancelButton: true,
        confirmButtonText: 'Salvar Detalhes',
        cancelButtonText: 'Cancelar',
        allowOutsideClick: false,
        inputValidator: (value) => {
            if (!value) return 'Você precisa descrever o atendimento para prosseguir!';
        }
    });

    if (!explicacao) return;

    const novaEtapa = (currentGroupedStudent.LigaEtapa || 0) + 1;
    const userEmail = getCurrentUserEmail(); 
    const agora = new Date();

    // --- FORMATAÇÃO DO TIMESTAMP PARA P4 ---
    // Resultado: "06/01/26 16:32"
    const dia = String(agora.getDate()).padStart(2, '0');
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    const ano = String(agora.getFullYear()).slice(-2);
    const hora = String(agora.getHours()).padStart(2, '0');
    const min = String(agora.getMinutes()).padStart(2, '0');
    const timestampFormatado = `${dia}/${mes}/${ano} ${hora}:${min}`;

    // Recupera o que já existe no p4 e adiciona o novo no topo com quebra de linha
    const valorP4Atual = (currentGroupedStudent.Propostas && currentGroupedStudent.Propostas.p4) ? currentGroupedStudent.Propostas.p4 : "";
    const novoTextoP4 = `${timestampFormatado} - ${explicacao}${valorP4Atual ? '\n' + valorP4Atual : ''}`;

    try {
        Swal.fire({ title: 'Salvando...', didOpen: () => Swal.showLoading() });
        const batch = writeBatch(db);
        
        currentGroupedStudent.todosIds.forEach(docId => {
            batch.update(doc(db, COBRANCA_COLLECTION, docId), {
                LigaEtapa: novaEtapa,
                UltimaAcao: agora,
                UltimoResponsavel: userEmail,
                "Propostas.p4": novoTextoP4, // Grava no campo P4 conforme solicitado
                HistoricoLogs: arrayUnion({
                    tipo: 'ligacao_atendida',
                    detalhe: `Atendimento #${novaEtapa}: ${explicacao}`,
                    responsavel: userEmail,
                    timestamp: agora.toISOString()
                })
            });
        });

        await batch.commit();

        // Sincroniza Cache Local e UI
        currentGroupedStudent.todosIds.forEach(id => {
            const idx = window.cobrancaList.findIndex(a => a.id === id);
            if (idx > -1) {
                window.cobrancaList[idx].LigaEtapa = novaEtapa;
                if(!window.cobrancaList[idx].Propostas) window.cobrancaList[idx].Propostas = {};
                window.cobrancaList[idx].Propostas.p4 = novoTextoP4;
            }
        });

        currentGroupedStudent.LigaEtapa = novaEtapa;
        if(!currentGroupedStudent.Propostas) currentGroupedStudent.Propostas = {};
        currentGroupedStudent.Propostas.p4 = novoTextoP4;

        updateStageButtons(currentGroupedStudent);
        renderCobrancaList(window.cobrancaList);
        
        // Atualiza o textarea no modal se ele estiver aberto
        const p4Element = document.getElementById('prop-4');
        if(p4Element) p4Element.value = novoTextoP4;

        Swal.fire('Registrado!', 'Atendimento salvo e P4 atualizado.', 'success');
    } catch (err) {
        console.error(err);
    }
}
window.LigaçãoAtendida = LigaçãoAtendida;

export async function VerificaçãoFeita() {
    if (!currentGroupedStudent) return;
    
    const novaEtapa = (currentGroupedStudent.TemplateEtapa || 0) + 1;
    const userEmail = getCurrentUserEmail(); 
    const agora = new Date();
    
    try {
        const batch = writeBatch(db);
        
        currentGroupedStudent.todosIds.forEach(docId => {
            batch.update(doc(db, COBRANCA_COLLECTION, docId), {
                TemplateEtapa: novaEtapa,
                UltimaVerificacao: agora, // Ativa o check visual de 2h
                UltimaAcao: agora,
                UltimoResponsavel: userEmail,
                HistoricoLogs: arrayUnion({
                    tipo: 'verificacao',
                    detalhe: `Aluno verificado no sistema #${novaEtapa}`,
                    responsavel: userEmail,
                    timestamp: agora.toISOString()
                })
            });
        });

        await batch.commit();

        // 2. SINCRONIZAÇÃO DA MEMÓRIA LOCAL (Para o check aparecer sem F5)
        currentGroupedStudent.todosIds.forEach(id => {
            const idx = window.cobrancaList.findIndex(a => a.id === id);
            if (idx > -1) {
                window.cobrancaList[idx].TemplateEtapa = novaEtapa;
                window.cobrancaList[idx].UltimaVerificacao = agora;
                window.cobrancaList[idx].UltimaAcao = agora;
            }
        });

        currentGroupedStudent.UltimaVerificacao = agora;
        currentGroupedStudent.TemplateEtapa = novaEtapa;

        updateStageButtons(currentGroupedStudent);
        renderCobrancaList(window.cobrancaList);
        
        // Pequeno feedback visual
        if (window.showToast) window.showToast("Verificação registrada!");

    } catch (err) {
        console.error("Erro ao verificar:", err);
    }
}
window.VerificaçãoFeita = VerificaçãoFeita;

// -------------------------
// 6. PROPOSTAS COM LOG DE QUEM DIGITOU
// -------------------------
window.saveProposal = async function(index) {
    if (!currentGroupedStudent) return;
    const textArea = document.getElementById(`prop-${index}`);
    if (!textArea) return;

    const newText = textArea.value;
    const userEmail = getCurrentUserEmail();
    const agora = new Date();
    const key = currentGroupedStudent.CPF || currentGroupedStudent.Email || currentGroupedStudent.Nome;

    // Sincroniza Cache Local e Global IMEDIATAMENTE
    if (!currentGroupedStudent.Propostas) currentGroupedStudent.Propostas = {};
    currentGroupedStudent.Propostas[`p${index}`] = newText;
    
    if (window.groupedCobrancaCache[key]) {
        window.groupedCobrancaCache[key].Propostas = currentGroupedStudent.Propostas;
    }

    try {
        const batch = writeBatch(db);
        currentGroupedStudent.todosIds.forEach(docId => {
            const updateData = {};
            updateData[`Propostas.p${index}`] = newText;
            updateData.UltimaAcao = agora;
            updateData.UltimoResponsavel = userEmail;
            batch.update(doc(db, COBRANCA_COLLECTION, docId), updateData);
        });
        await batch.commit();
        
        // Efeito visual de salvamento
        textArea.style.backgroundColor = "#f0fff4"; 
        setTimeout(() => textArea.style.backgroundColor = "", 800);
    } catch (e) { console.error("Erro ao salvar proposta:", e); }
};

// -------------------------
// 7. STATUS EXTRA & PAGAMENTO
// -------------------------
window.saveExtraStatus = async function () {
  // 1. Verifica se há um aluno selecionado (seja agrupado ou individual)
  const alunoParaAtualizar = currentGroupedStudent || (currentActionStudentId ? { id: currentActionStudentId, todosIds: [currentActionStudentId] } : null);

  if (!alunoParaAtualizar) return;
  
  const sel = document.getElementById('extra-status-select');
  const value = sel ? sel.value : '';

  try {
    // 2. CHAMADA DA FUNÇÃO (Isso ativa a função que estava apagada!)
    await salvarTagParaTodosOsCursos(alunoParaAtualizar, value);

    // 3. Sincroniza a memória local para o card atualizar na tela sem F5
    const ids = alunoParaAtualizar.todosIds || [alunoParaAtualizar.id];
    ids.forEach(id => {
      const idx = window.cobrancaList.findIndex(a => a.id === id);
      if (idx > -1) {
        if (value) {
          window.cobrancaList[idx].StatusExtra = { tipo: value };
          window.cobrancaList[idx].DataTag = new Date();
        } else {
          delete window.cobrancaList[idx].StatusExtra;
          delete window.cobrancaList[idx].DataTag;
        }
      }
    });

    // 4. Atualiza a lista visual e o cabeçalho do modal
    renderCobrancaList(window.cobrancaList);
    
    const modalHeader = document.querySelector('.actions-header');
    if (modalHeader) {
      modalHeader.className = 'actions-header';
      if (value) {
        const safe = value.replace(/[\s_]+/g, '-').toLowerCase();
        modalHeader.classList.add(`header-status-${safe}`);
      }
    }

    window.showToast(value ? "Status atualizado em todos os cursos!" : "Status removido!");

  } catch (error) { 
    console.error("Erro ao processar salvamento:", error); 
    window.showToast("Erro ao atualizar os cursos.", "error");
  }
};

window.registerPayment = async function() {
    if (!currentGroupedStudent) return;

    // 1. Captura os cursos marcados
    const checkboxes = document.querySelectorAll('.course-payment-check:checked');
    
    if (checkboxes.length === 0) {
        return Swal.fire('Atenção', 'Selecione pelo menos um curso para baixar.', 'warning');
    }

    const dateVal = document.getElementById('payment-date')?.value;
    const originVal = document.getElementById('payment-origin')?.value;
    const userEmail = getCurrentUserEmail();

    if (!dateVal || !originVal) {
        return Swal.fire('Campos Obrigatórios', 'Preencha a data e a origem.', 'warning');
    }

    const result = await Swal.fire({
        title: 'Confirmar Baixa?',
        text: "Os valores editados serão registrados como o pagamento final destes cursos.",
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#28a745',
        confirmButtonText: 'Sim, registrar!'
    });

    if (!result.isConfirmed) return;

    try {
        Swal.fire({ title: 'Processando...', didOpen: () => Swal.showLoading() });

        const [ano, mes, dia] = dateVal.split('-').map(Number);
        const dataCorreta = new Date(ano, mes - 1, dia, 12, 0, 0);

        const batch = writeBatch(db);
        
        // 2. Iterar pelos itens selecionados para pegar o valor de cada input
        checkboxes.forEach(cb => {
            const docId = cb.value;
            // Busca o input de valor correspondente a este curso (pelo data-id)
            const inputValor = document.querySelector(`.course-payment-amount[data-id="${docId}"]`);
            const valorFinal = inputValor ? inputValor.value : "0,00";

            const docRef = doc(db, COBRANCA_COLLECTION, docId);
            batch.update(docRef, {
                Status: 'Pago',
                DataPagamento: dataCorreta,
                OrigemPagamento: originVal,
                ValorPago: `R$ ${valorFinal}`, // Registramos o valor que foi efetivamente pago
                BaixadoPor: userEmail,
                HistoricoLogs: arrayUnion({
                    tipo: "pagamento",
                    detalhe: `Baixa com valor ajustado: R$ ${valorFinal} (${originVal})`,
                    responsavel: userEmail,
                    timestamp: new Date().toISOString()
                })
            });
        });

        await batch.commit();
        
        closeActionsModal();
        Swal.fire('Sucesso!', 'Baixa(s) realizada(s) com os valores informados.', 'success');
        
        if (typeof loadCobrancaData === 'function') loadCobrancaData();

    } catch (error) { 
        console.error(error);
        Swal.fire('Erro', 'Falha ao processar pagamento.', 'error');
    }
};

window.archiveStudent = async function(docId) {
  // 1. Substituindo o confirm nativo pelo SweetAlert2
  const result = await Swal.fire({
      title: 'Tem certeza?',
      text: "Você não poderá reverter isso!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545', // Vermelho (perigo)
      cancelButtonColor: '#6c757d',  // Cinza
      confirmButtonText: 'Sim, excluir!',
      cancelButtonText: 'Cancelar'
  });

  // 2. Se o usuário NÃO confirmou, paramos aqui.
  if (!result.isConfirmed) return;

  try {
    // Exibe loading enquanto deleta
    Swal.fire({ title: 'Excluindo...', didOpen: () => Swal.showLoading() });
    
    await deleteDoc(doc(db, COBRANCA_COLLECTION, docId));
    
    // Sucesso!
    Swal.fire(
      'Excluído!',
      'O registro foi removido.',
      'success'
    );
    
    loadCobrancaData();
  } catch (error) { 
      // Erro
      Swal.fire('Erro!', error.message, 'error');
  }
};

// -------------------------
// 8. EXPORTAR ATIVOS (SEM STATUS EXTRA)
// -------------------------
window.exportActiveCobranca = function() {
    // 1. Verificações de segurança (Mantido da antiga)
    if (!window.cobrancaList || window.cobrancaList.length === 0) {
        if(window.showToast) window.showToast("Não há dados carregados para exportar.", "warning");
        else alert("Não há dados carregados.");
        return;
    }

    // 2. Filtro (Mantido da antiga: Pega apenas quem NÃO tem StatusExtra)
    const dataToExport = window.cobrancaList.filter(aluno => {
        const temStatus = aluno.StatusExtra && aluno.StatusExtra.tipo && aluno.StatusExtra.tipo !== "";
        return !temStatus; 
    });

    if (dataToExport.length === 0) {
        if(window.showToast) window.showToast("Nenhum contato sem tag encontrado.", "info");
        else alert("Nenhum contato encontrado.");
        return;
    }

    // 3. Cabeçalho novo solicitado (Separado por vírgula)
    let csvContent = "number,info_1,info_2,info_3\n";

    dataToExport.forEach(row => {
        // --- LÓGICA DE TRATAMENTO DO TELEFONE (NOVA) ---
        let phone = (row.Telefone || "").toString().replace(/\D/g, ""); // Remove tudo que não é número

        // A. Remove o 55 do início se o número for longo (maior que 11 dígitos, ex: 55419...)
        if (phone.startsWith("55") && phone.length > 11) {
            phone = phone.substring(2);
        }

        // B. Verifica se precisa do 9º dígito
        // Se após limpar ficou com 10 dígitos (Ex: 41 8888 7777), insere o 9 na 3ª posição
        if (phone.length === 10) {
            const ddd = phone.substring(0, 2);
            const numero = phone.substring(2);
            phone = `${ddd}9${numero}`;
        }
        // -----------------------------------------------

        // Função auxiliar para limpar vírgulas dos textos (pois a vírgula agora é separador)
        const clean = (txt) => (txt ? String(txt).replace(/,/g, " ") : "");

        // Mapeamento das colunas
        const number = phone;
        const info1  = clean(row.Nome);             // info_1: Nome
        const info2  = clean(row.Email || "");      // info_2: Email
        const info3  = clean(row.Curso || "");      // info_3: Curso

        // Monta a linha
        csvContent += `${number},${info1},${info2},${info3}\n`;
    });

    // 4. Download do Arquivo (Mantido o BOM \ufeff para o Excel ler acentos corretamente)
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    
    link.setAttribute("href", url);
    // Nome do arquivo atualizado para identificar que é mailing
    link.setAttribute("download", `Mailing_Cobranca_${hoje}.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// ==============================================================
// 9. RELATÓRIO DE PAGAMENTOS (NOVA FUNCIONALIDADE)
// ==============================================================

window.openPaymentsModal = function() {
    const overlay = document.getElementById('payments-modal-overlay');
    if(overlay) {
        overlay.classList.remove('modal-hidden');
        overlay.style.display = 'flex';
        loadPaymentsList(); 
    }
}

window.closePaymentsModal = function() {
    const overlay = document.getElementById('payments-modal-overlay');
    if(overlay) overlay.classList.add('modal-hidden');
}

async function loadPaymentsList() {
    const tbody = document.getElementById('payments-table-body');
    const countEl = document.getElementById('total-payments-count');
    
    if(tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center"><div class="loader-small"></div> Carregando...</td></tr>';

    try {
        // Busca apenas onde Status == 'Pago'
        const q = query(
            collection(db, COBRANCA_COLLECTION), 
            where("Status", "==", "Pago")
        );
        
        const snap = await getDocs(q);
        let list = [];
        
        snap.forEach(doc => {
            list.push({ id: doc.id, ...doc.data() });
        });

        list.sort((a, b) => {
            const dA = a.DataPagamento ? (a.DataPagamento.toDate ? a.DataPagamento.toDate() : new Date(a.DataPagamento)) : new Date(0);
            const dB = b.DataPagamento ? (b.DataPagamento.toDate ? b.DataPagamento.toDate() : new Date(b.DataPagamento)) : new Date(0);
            return dB - dA;
        });

        if(countEl) countEl.textContent = list.length;
        renderPaymentsTable(list);

    } catch (err) {
        console.error("Erro ao carregar pagamentos:", err);
        if(tbody) tbody.innerHTML = '<tr><td colspan="5" style="color:red; text-align:center;">Erro ao buscar dados.</td></tr>';
    }
}

function renderPaymentsTable(list) {
    const tbody = document.getElementById('payments-table-body');
    if(!tbody) return;
    tbody.innerHTML = "";

    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px;">Nenhum pagamento registrado ainda.</td></tr>';
        return;
    }

    list.forEach(item => {
        const tr = document.createElement('tr');
        
        let dataBaixa = "-";
        if(item.DataPagamento) {
            const d = item.DataPagamento.toDate ? item.DataPagamento.toDate() : new Date(item.DataPagamento);
            dataBaixa = d.toLocaleDateString('pt-BR');
        }

        // LÓGICA DE PRIORIDADE: Prioriza o valor ajustado (ValorPago)
        const valorExibido = item.ValorPago || item.Valor || '-';
        
        // Estilização extra para identificar quando o valor foi alterado
        const estiloValor = item.ValorPago ? 'color: #28a745; font-weight: 700;' : 'font-weight: 600;';

        const responsavel = item.BaixadoPor || '<span style="color:#999; font-style:italic;">Não registrado</span>';

        tr.innerHTML = `
        <td><strong>${dataBaixa}</strong></td>
        <td>${item.Nome}</td>
        <td style="${estiloValor}">${valorExibido}</td>
        <td>
            <span style="background: #e9ecef; padding: 4px 10px; border-radius: 4px; font-size: 12px; white-space: nowrap; display: inline-block; line-height: 1.2;">
                ${item.OrigemPagamento || '-'}
            </span>
        </td>
        <td style="color: #198754; font-weight: 600;">${responsavel}</td>
    `;
    tbody.appendChild(tr);
    });
}

// Expor globalmente para o HTML acessar
window.loadPaymentsList = loadPaymentsList;

// -------------------------
// 10. EXPORTAR PAGAMENTOS (EXCEL)
// -------------------------
window.exportPaymentsExcel = async function() {
    // 1. Busca os dados atualizados (Status = Pago)
    try {
        const q = query(
            collection(db, COBRANCA_COLLECTION), 
            where("Status", "==", "Pago")
        );
        const snap = await getDocs(q);
        
        if (snap.empty) return alert("Não há pagamentos para exportar.");

        let list = [];
        snap.forEach(doc => list.push(doc.data()));

        // 2. Ordena por DataPagamento
        list.sort((a, b) => {
            const dA = a.DataPagamento ? (a.DataPagamento.toDate ? a.DataPagamento.toDate() : new Date(a.DataPagamento)) : new Date(0);
            const dB = b.DataPagamento ? (b.DataPagamento.toDate ? b.DataPagamento.toDate() : new Date(b.DataPagamento)) : new Date(0);
            return dB - dA;
        });

        // 3. Monta Tabela HTML para o Excel
        let table = `
            <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
            <head><meta charset="UTF-8"></head>
            <body>
            <table border="1">
                <thead>
                    <tr style="background-color: #198754; color: white;">
                        <th>NOME</th>
                        <th>E-MAIL</th>
                        <th>CPF</th>
                        <th>TELEFONE</th>
                        <th>CURSO</th>
                        <th>FORMA DE PG</th>
                        <th>VALOR</th>
                        <th>VENCIMENTO</th>
                        <th>DATA 3° COB</th>
                        <th>DATA 1° JUR.</th>
                        <th>DATA DO PAGAMENTO</th>
                        <th>RESPONSÁVEL PELO LINK</th>
                        <th>CLASSIFICAÇÃO DO PAGAMENTO</th>
                        <th>HORÁRIO DA BAIXA (LOG)</th>
                    </tr>
                </thead>
                <tbody>
        `;

        // Helper para formatar data curta (DD/MM/AAAA)
        const fmt = (d) => {
            if (!d) return '-';
            const dateObj = d.toDate ? d.toDate() : new Date(d);
            return isNaN(dateObj) ? '-' : dateObj.toLocaleDateString('pt-BR');
        };

        // Helper para formatar Data e Hora Completa (DD/MM/AAAA HH:mm:ss)
        const fmtDateTime = (d) => {
            if (!d) return '-';
            // Converte a string ISO do log em objeto Date
            const dateObj = new Date(d);
            return isNaN(dateObj) ? '-' : dateObj.toLocaleDateString('pt-BR') + ' ' + dateObj.toLocaleTimeString('pt-BR');
        };

        list.forEach(item => {
            // Busca o log específico no array HistoricoLogs fornecido
            const logPagamento = (item.HistoricoLogs || []).find(log => log.tipo === "pagamento");

            // Se encontrar o log, formata o campo timestamp (string ISO)
            const timestampLog = logPagamento ? fmtDateTime(logPagamento.timestamp) : '-';

            table += `
                <tr>
                    <td>${item.Nome || '-'}</td>
                    <td>${item.Email || '-'}</td>
                    <td style="mso-number-format:'@'">${item.CPF || '-'}</td> 
                    <td style="mso-number-format:'@'">${item.Telefone || '-'}</td>
                    <td>${item.Curso || '-'}</td>
                    <td>${item.FormaPag || '-'}</td>
                    <td>${item.Valor || '-'}</td>
                    <td>${item.Vencimento || '-'}</td>
                    <td>${fmt(item.Data3Cob)}</td>
                    <td>${fmt(item.Data1Jur)}</td>
                    <td>${fmt(item.DataPagamento)}</td>
                    <td>${item.BaixadoPor || '-'}</td>
                    <td>${item.OrigemPagamento || '-'}</td>
                    <td>${timestampLog}</td>
                </tr>
            `;
        });

        table += `</tbody></table></body></html>`;

        // 4. Download
        const blob = new Blob([table], { type: 'application/vnd.ms-excel' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
        a.download = `Relatorio_Pagamentos_3Cob_${hoje}.xls`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

    } catch (err) {
        console.error("Erro export:", err);
        alert("Erro ao exportar pagamentos.");
    }
};

// =========================================================
// 10. EXPORTAR ALUNOS PENDENTES (Sem Tag E Sem Ligação Recente)
// =========================================================
window.exportNoAnswerStudents = function() {
    const horasInput = prompt("Exportar alunos que não atenderam nas últimas X horas:", "3");
    if (horasInput === null) return; 

    const horas = parseFloat(horasInput.replace(',', '.'));
    if (isNaN(horas) || horas < 0) return alert("Digite um número válido.");

    const agora = new Date();
    const tempoCorte = new Date(agora.getTime() - (horas * 60 * 60 * 1000));

    const listaParaExportar = window.cobrancaList.filter(aluno => {
        // 1. FILTRO DE TAG: Exclui qualquer aluno que possua StatusExtra
        const temTag = aluno.StatusExtra && (aluno.StatusExtra.tipo || aluno.StatusExtra) && (aluno.StatusExtra.tipo !== "" && aluno.StatusExtra !== "");
        if (temTag) return false; 

        // 2. LÓGICA DE LOGS: Exclui se teve ATENDEU (ligacao_atendida)
        const logs = aluno.HistoricoLogs || [];
        const teveInteracaoRecente = logs.some(log => {
            const ehLogAlvo = log.tipo === 'ligacao_atendida';
            if (!ehLogAlvo) return false;

            const dataLog = new Date(log.timestamp);
            return dataLog > tempoCorte; 
        });

        if (teveInteracaoRecente) return false;

        return true;
    });

    if (listaParaExportar.length === 0) {
        return alert(`Nenhum aluno sem resposta encontrado nas últimas ${horas}h.`);
    }

    if(!confirm(`Deseja exportar ${listaParaExportar.length} alunos?`)) return;

    // ... (restante da lógica de montagem da tabela e download permanece igual)
    let table = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="UTF-8"></head>
        <body>
        <table border="1">
            <thead>
                <tr style="background-color: #007bff; color: white; font-weight: bold;">
                    <th>NOME</th>
                    <th>EMAIL</th>
                    <th>TELEFONE</th>
                    <th>PRODUTO</th>
                    <th>VALOR</th>
                    <th>DATA DE VENCIMENTO</th>
                </tr>
            </thead>
            <tbody>
    `;

    listaParaExportar.forEach(item => {
        let phone = (item.Telefone || "").toString().replace(/\D/g, "");
        if (phone.startsWith("55") && phone.length !== 13) {
            const ddi_ddd = phone.substring(0, 4); 
            const resto = phone.substring(4);      
            phone = ddi_ddd + "9" + resto;         
        }

        table += `
            <tr>
                <td>${item.Nome || '-'}</td>
                <td>${item.Email || '-'}</td>
                <td style="mso-number-format:'@'">${phone || '-'}</td>
                <td>${item.Curso || '-'}</td>
                <td>${item.Valor || "0,00"}</td>
                <td>${item.Vencimento || "-"}</td>
            </tr>
        `;
    });

    table += `</tbody></table></body></html>`;

    const blob = new Blob([table], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Export_Sem_Resposta_${horas}h.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};