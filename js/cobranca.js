// js/cobranca.js
import { db, auth } from './firebase.js'; 
import {
  collection, getDocs, query, orderBy, addDoc,
  updateDoc, doc, arrayUnion, deleteDoc, where, deleteField 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { formatDateUTC, parseDateBR, mapStatusToLabel } from './utils.js';

export const COBRANCA_COLLECTION = 'controle_3_cobranca';
window.COBRANCA_COLLECTION = COBRANCA_COLLECTION; 

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
    const q = query(collection(db, COBRANCA_COLLECTION), orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);

    const rawList = [];
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0); // Zera hora para cálculo de dias

    // Loop inicial para processar dados e checar Tags
    querySnapshot.forEach((docSnap) => {
        let aluno = { id: docSnap.id, ...docSnap.data() };

        // ============================================================
        // ⏰ "FAXINEIRO": VERIFICA SE A TAG EXPIROU (3 DIAS)
        // ============================================================
        // Normaliza o nome da tag para verificar
        const tagAtual = aluno.StatusExtra?.tipo || aluno.StatusExtra;

        // LISTA DE EXCEÇÕES: Tags que NUNCA expiram
        const tagsPermanentes = ['Link agendado', 'Jurídica'];

        // Só entra na verificação se tiver tag, tiver data E NÃO FOR PERMANENTE
        if (tagAtual && aluno.DataTag && !tagsPermanentes.includes(tagAtual)) {
            
            const dataTag = aluno.DataTag.toDate ? aluno.DataTag.toDate() : new Date(aluno.DataTag);
            const diffTempo = new Date() - dataTag;
            const diasPassados = diffTempo / (1000 * 60 * 60 * 24);

            if (diasPassados >= 3) {
                console.log(`Tag expirada: ${tagAtual} para ${aluno.Nome}. Limpando...`);

                aluno.StatusExtra = null;
                aluno.DataTag = null;

                const docRef = doc(db, COBRANCA_COLLECTION, aluno.id);
                updateDoc(docRef, {
                    StatusExtra: deleteField(),
                    DataTag: deleteField()
                }).catch(err => console.error("Erro ao remover tag:", err));
            }
        }
        // ============================================================

        rawList.push(aluno);
    });

    // --- FILTRO: JANELA DE 31 A 45 DIAS ---
    window.cobrancaList = rawList.filter(aluno => {
        // 1. Se já pagou, remove
        if (aluno.Status === 'Pago') return false;

        // 2. Se não tem vencimento, mostra por segurança
        if (!aluno.Vencimento) return true;

        // 3. Cálculo de dias de atraso
        const dataVenc = parseDateBR(aluno.Vencimento); // Certifique-se que essa função existe
        if (!dataVenc) return true; 
        
        dataVenc.setHours(0, 0, 0, 0);
        
        const diffTime = hoje - dataVenc;
        const diasAtraso = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // Salva para exibir no card
        aluno.diasAtrasoCalculado = diasAtraso;

        // REGRA: Mostrar apenas entre 31 e 45 dias (Jurídico é >= 45)
        return diasAtraso >= 31 && diasAtraso < 45;
    });

    // Atualiza contador KPI
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

export function renderCobrancaList(data) {
  const container = document.getElementById('cobranca-list');
  if (!container) return;

  container.innerHTML = '';

  if (!data || data.length === 0) {
    container.innerHTML = '<p class="empty-msg">Nenhum aluno na fase de 3ª Cobrança!</p>';
    return;
  }

  const sortedData = data.sort((a, b) => (a.diasAtrasoCalculado || 0) - (b.diasAtrasoCalculado || 0));

  sortedData.forEach(aluno => {
      // Badge de dias
      const diasLabel = aluno.diasAtrasoCalculado 
          ? `<span style="background:#fff3cd; color:#856404; padding:2px 6px; border-radius:4px; font-size:11px; font-weight:bold; margin-left:5px;">${aluno.diasAtrasoCalculado} dias</span>`
          : '';
      
      const dataLimite = aluno.Data1Jur ? (typeof formatDateUTC === 'function' ? formatDateUTC(aluno.Data1Jur) : aluno.Data1Jur) : 'N/A';

      // -----------------------------------------------------------
      // LÓGICA DO CRONÔMETRO (COM DIAGNÓSTICO)
      // -----------------------------------------------------------
      const tagNome = aluno.StatusExtra?.tipo || aluno.StatusExtra || null;
      const safeClass = String(tagNome || "nenhum").replace(/_/g, '-').replace(/\s+/g, '-').toLowerCase();

      let timeLabelHtml = '';

      // LISTA DE EXCEÇÕES VISUAIS
      const tagsPermanentes = ['Link agendado', 'Jurídica'];

      // Só calcula o tempo se NÃO for uma tag permanente
      if (tagNome && aluno.DataTag && !tagsPermanentes.includes(tagNome)) {
          const dataTag = aluno.DataTag.toDate ? aluno.DataTag.toDate() : new Date(aluno.DataTag);
          const agora = new Date();
          
          const diffDias = (agora - dataTag) / (1000 * 60 * 60 * 24);
          const diasRestantes = 3 - diffDias;

          let textoTempo = '';
          if (diasRestantes < 0) {
            textoTempo = '(expirando...)';
          } else if (diasRestantes < 1) {
            const horas = Math.ceil(diasRestantes * 24);
            textoTempo = `(${horas}h rest.)`;
          } else {
            textoTempo = `(${Math.ceil(diasRestantes)}d rest.)`;
          }

          timeLabelHtml = `<span style="font-size:0.85em; opacity:1; margin-left:6px; color:#333; font-weight:bold;">${textoTempo}</span>`;
      }
      // -------------------

      if (tagNome && aluno.DataTag) {
          const dataTag = aluno.DataTag.toDate ? aluno.DataTag.toDate() : new Date(aluno.DataTag);
          const agora = new Date();
          
          const diffDias = (agora - dataTag) / (1000 * 60 * 60 * 24);
          const diasRestantes = 3 - diffDias;

          let textoTempo = '';
          if (diasRestantes < 0) {
             textoTempo = '(expirando...)';
          } else if (diasRestantes < 1) {
             const horas = Math.ceil(diasRestantes * 24);
             textoTempo = `(${horas}h rest.)`;
          } else {
             textoTempo = `(${Math.ceil(diasRestantes)}d rest.)`;
          }

          // Forcei uma cor preta aqui para garantir que não esteja invisível
          timeLabelHtml = `<span style="font-size:0.85em; opacity:1; margin-left:6px; color:#333; font-weight:bold;">${textoTempo}</span>`;
      }

      const labelTag = typeof mapStatusToLabel === 'function' ? mapStatusToLabel(tagNome) : tagNome;

      const statusLabelHtml = tagNome
        ? `<p class="extra-status">${labelTag} ${timeLabelHtml}</p>`
        : '';

      const ligaCount = aluno.LigaEtapa || 0;
      const msgCount = aluno.TemplateEtapa || 0;
  
      const card = document.createElement('div');
      card.className = `cobranca-card status-${safeClass}`;
  
      card.innerHTML = `
        <div class="card-info">
          <h3>${aluno.Nome}</h3>
          <p style="margin-top:10px;"><strong>Curso:</strong> ${aluno.Curso || '-'}</p>
          <p><strong>Valor:</strong> ${aluno.Valor || '-'} | <strong>Venc:</strong> ${aluno.Vencimento || '-'} ${diasLabel}</p>
          <p style="margin-top:5px; font-size:12px; color:#555;">
              📞 Ligações: <strong>${ligaCount}</strong> | 💬 Templates: <strong>${msgCount}</strong>
          </p>
          <p class="limit-date">⚠️ Jurídico em: ${dataLimite}</p>
          ${statusLabelHtml}
        </div>
        <div class="card-actions">
          <button class="btn-actions-open" onclick="window.openActionsModal('${aluno.id}')">⚡ Ações</button>
          <div class="small-actions">
            <button class="icon-btn trash-icon admin-only" onclick="window.archiveStudent('${aluno.id}')">🗑️</button>
          </div>
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

// -------------------------
// 4. MODAL DE AÇÕES (DETALHES)
// -------------------------
export function openActionsModal(docId) {
  const aluno = window.cobrancaList.find(a => a.id === docId);
  if (!aluno) return;

  currentActionStudentId = docId;
  
  // 1. Preenche Dados básicos
  document.getElementById('actions-student-name').textContent = aluno.Nome;
  document.getElementById('actions-student-details').innerHTML = `
    <p><strong>Email:</strong> ${aluno.Email || '-'}</p>
    <p><strong>Telefone:</strong> ${aluno.Telefone || '-'}</p>
    <p><strong>CPF:</strong> ${aluno.CPF || '-'}</p>
    <p><strong>Valor:</strong> ${aluno.Valor || '-'} (${aluno.FormaPag || '-'})</p>
  `;

  // 2. Preenche o Select com o Status Atual
  // Tenta pegar o valor de diferentes formatos (string antiga ou objeto novo)
  const tagAtual = aluno.StatusExtra?.tipo || aluno.StatusExtra || '';
  
  const select = document.getElementById("extra-status-select");
  if (select) select.value = tagAtual;

  // 3. Preenche Propostas
  const props = aluno.Propostas || {};
  for(let i=1; i<=4; i++) {
      const el = document.getElementById(`prop-${i}`);
      if(el) el.value = props[`p${i}`] || '';
  }

  // 4. Atualiza botões de etapa (se houver essa função)
  if (typeof updateStageButtons === 'function') {
      updateStageButtons(aluno);
  }

  // 5. Atualiza a cor do cabeçalho do Modal (Visual)
  const modalHeader = document.querySelector('.actions-header');
  if (modalHeader) {
      modalHeader.className = 'actions-header'; // Reseta classes para o padrão
      
      if(tagAtual) {
          // --- CORREÇÃO AQUI ---
          // Usamos a variável 'tagAtual' (que vem do aluno) e não 'value'
          const safe = String(tagAtual).replace(/[\s_]+/g, '-').toLowerCase();
          
          // Gera classe ex: header-status-link-agendado
          modalHeader.classList.add(`header-status-${safe}`);
      }
  }

  // (Removido o window.showToast daqui, pois só deve aparecer ao salvar, não ao abrir)

  // 6. Exibe o Modal
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

  const callStep = (aluno.LigaEtapa || 0) + 1;
  const tempStep = (aluno.TemplateEtapa || 0) + 1;

  if (callBtn) callBtn.textContent = `📞 Ligar #${callStep}`;
  if (tempBtn) tempBtn.textContent = `💬 Template #${tempStep}`;
  
  // Exibe quem fez a última ação
  if (infoTxt && aluno.UltimaAcao) {
      const date = aluno.UltimaAcao.toDate ? aluno.UltimaAcao.toDate() : new Date(aluno.UltimaAcao);
      const responsavel = aluno.UltimoResponsavel || 'Sistema';
      infoTxt.innerHTML = `Última: ${date.toLocaleString('pt-BR')}<br><small>Por: ${responsavel}</small>`;
  } else if (infoTxt) {
      infoTxt.textContent = '';
  }
}
window.updateStageButtons = updateStageButtons;

export async function nextCallStage() {
  if (!currentActionStudentId) return;
  const aluno = window.cobrancaList.find(a => a.id === currentActionStudentId);
  if (!aluno) return;

  const novaEtapa = (aluno.LigaEtapa || 0) + 1;
  const userEmail = getCurrentUserEmail(); 
  
  try {
    const alunoRef = doc(db, COBRANCA_COLLECTION, currentActionStudentId);
    await updateDoc(alunoRef, {
      LigaEtapa: novaEtapa,
      UltimaAcao: new Date(),
      UltimoResponsavel: userEmail,
      HistoricoLogs: arrayUnion({
        tipo: 'ligacao',
        detalhe: `Ligação #${novaEtapa} realizada`,
        responsavel: userEmail,
        timestamp: new Date().toISOString()
      })
    });

    aluno.LigaEtapa = novaEtapa;
    aluno.UltimaAcao = new Date();
    aluno.UltimoResponsavel = userEmail;
    
    updateStageButtons(aluno);
    renderCobrancaList(window.cobrancaList);

  } catch (err) {
    console.error(err);
    alert("Erro ao salvar etapa.");
  }
}
window.nextCallStage = nextCallStage;

export async function nextTemplateStage() {
  if (!currentActionStudentId) return;
  const aluno = window.cobrancaList.find(a => a.id === currentActionStudentId);
  if (!aluno) return;

  const novaEtapa = (aluno.TemplateEtapa || 0) + 1;
  const userEmail = getCurrentUserEmail();
  
  try {
    const alunoRef = doc(db, COBRANCA_COLLECTION, currentActionStudentId);
    await updateDoc(alunoRef, {
      TemplateEtapa: novaEtapa,
      UltimaAcao: new Date(),
      UltimoResponsavel: userEmail,
      HistoricoLogs: arrayUnion({
        tipo: 'template',
        detalhe: `Template #${novaEtapa} enviado`,
        responsavel: userEmail,
        timestamp: new Date().toISOString()
      })
    });

    aluno.TemplateEtapa = novaEtapa;
    aluno.UltimaAcao = new Date();
    aluno.UltimoResponsavel = userEmail;
    
    updateStageButtons(aluno);
    renderCobrancaList(window.cobrancaList);

  } catch (err) {
    console.error(err);
    alert("Erro ao salvar etapa.");
  }
}
window.nextTemplateStage = nextTemplateStage;

// -------------------------
// 6. PROPOSTAS COM LOG DE QUEM DIGITOU
// -------------------------
window.saveProposal = async function(index) {
  if (!currentActionStudentId) return;
  
  const textArea = document.getElementById(`prop-${index}`);
  const newText = textArea ? textArea.value : '';
  
  const aluno = window.cobrancaList.find(a => a.id === currentActionStudentId);
  if(!aluno.Propostas) aluno.Propostas = {};
  
  const oldText = aluno.Propostas[`p${index}`] || '';
  if (newText === oldText) return;

  aluno.Propostas[`p${index}`] = newText;
  const userEmail = getCurrentUserEmail();

  try {
      await updateDoc(doc(db, COBRANCA_COLLECTION, currentActionStudentId), { 
          Propostas: aluno.Propostas,
          HistoricoLogs: arrayUnion({
              tipo: 'proposta',
              detalhe: `Editou Proposta ${index}`,
              conteudo: newText.substring(0, 50) + "...", 
              responsavel: userEmail,
              timestamp: new Date().toISOString()
          })
      });
      console.log(`Proposta ${index} salva por ${userEmail}`);
  } catch(e) { console.error(e); }
};

// -------------------------
// 7. STATUS EXTRA & PAGAMENTO
// -------------------------
window.saveExtraStatus = async function () {
  if (!currentActionStudentId) return;
  
  const sel = document.getElementById('extra-status-select');
  const value = sel ? sel.value : '';
  const userEmail = getCurrentUserEmail();
  const docRef = doc(db, COBRANCA_COLLECTION, currentActionStudentId);

  try {
    // 1. Salva ou Remove no Banco
    if (value) {
        await updateDoc(docRef, {
          StatusExtra: { tipo: value, atualizadoEm: new Date(), por: userEmail },
          UltimoResponsavel: userEmail,
          DataTag: new Date() // Salva data para o cronômetro
        });
    } else {
        await updateDoc(docRef, {
          StatusExtra: deleteField(),
          DataTag: deleteField(),
          UltimoResponsavel: userEmail
        });
    }
    
    // 2. Atualiza a lista local e a tela
    const idx = window.cobrancaList.findIndex(a => a.id === currentActionStudentId);
    
    if (idx > -1) {
      // Atualiza memória
      if (value) {
          window.cobrancaList[idx].StatusExtra = { tipo: value };
          window.cobrancaList[idx].DataTag = new Date();
      } else {
          delete window.cobrancaList[idx].StatusExtra;
          delete window.cobrancaList[idx].DataTag;
      }
      
      // Atualiza a lista atrás do modal
      renderCobrancaList(window.cobrancaList);
      
      // --- CORREÇÃO DO ERRO AQUI ---
      // Atualiza a cor do cabeçalho do Modal Aberto
      const modalHeader = document.querySelector('.actions-header');
      if (modalHeader) {
          modalHeader.className = 'actions-header'; // Reseta classes
          
          if(value) {
              // Troca ESPAÇOS (\s) e UNDERLINES (_) por hífen (-)
              // Ex: "Link enviado" vira "link-enviado"
              const safe = value.replace(/[\s_]+/g, '-').toLowerCase();
              
              // Adiciona classe válida: header-status-link-enviado
              modalHeader.classList.add(`header-status-${safe}`);
          }
      }
    }

    window.showToast(value ? "Status atualizado!" : "Status removido!");

  } catch (error) { 
      console.error(error); 
      window.showToast("Erro ao atualizar.", "error");
  }
};

window.registerPayment = async function() {
  if (!currentActionStudentId) return;
  
  const dateVal = document.getElementById('payment-date')?.value;
  const originVal = document.getElementById('payment-origin')?.value;
  const userEmail = getCurrentUserEmail();

  // 1. Validação Visual
  if (!dateVal || !originVal) {
      return Swal.fire('Campos Obrigatórios', 'Preencha a data e a origem do pagamento.', 'warning');
  }

  // 2. Confirmação
  const result = await Swal.fire({
      title: 'Confirmar Baixa?',
      text: "O status mudará para 'Pago' e o aluno sairá desta lista.",
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#28a745',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sim, confirmar!',
      cancelButtonText: 'Cancelar'
  });

  if (!result.isConfirmed) return;

  try {
    // 3. Loading
    Swal.fire({ title: 'Processando...', didOpen: () => Swal.showLoading() });

    // --- CORREÇÃO DE DATA AQUI ---
    // Pega "2025-12-18" e divide em partes
    const [ano, mes, dia] = dateVal.split('-').map(Number);
    
    // Cria a data usando o horário do navegador (Local) e define para meio-dia (12h)
    // Isso evita que fusos horários joguem a data para o dia anterior
    const dataCorreta = new Date(ano, mes - 1, dia, 12, 0, 0);

    await updateDoc(doc(db, COBRANCA_COLLECTION, currentActionStudentId), {
      Status: 'Pago',
      DataPagamento: dataCorreta, // Usa a data ajustada
      OrigemPagamento: originVal,
      BaixadoPor: userEmail
    });
    
    closeActionsModal();

    // 4. Sucesso
    Swal.fire('Baixa Realizada!', 'O pagamento foi registrado com sucesso.', 'success');
    
    loadCobrancaData();
  } catch (error) { 
      console.error(error);
      Swal.fire('Erro', 'Não foi possível registrar o pagamento.', 'error');
  }
};

async function setExtraTag(studentId, tagName) {
    try {
        const docRef = doc(db, COBRANCA_COLLECTION, studentId);
        
        await updateDoc(docRef, {
            StatusExtra: tagName, // A tag (ex: "Promessa Pagamento")
            DataTag: new Date()   // <--- O PULO DO GATO: Salva o momento exato
        });

        if(window.showToast) window.showToast("Tag aplicada!", "success");
        loadCobrancaData(); // Recarrega a tela
    } catch (e) {
        console.error(e);
    }
}

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
    if (!window.cobrancaList || window.cobrancaList.length === 0) {
        return alert("Não há dados carregados para exportar.");
    }

    const dataToExport = window.cobrancaList.filter(aluno => {
        const temStatus = aluno.StatusExtra && aluno.StatusExtra.tipo && aluno.StatusExtra.tipo !== "";
        return !temStatus; 
    });

    if (dataToExport.length === 0) {
        return alert("Nenhum aluno ativo 'sem status' encontrado para exportação.");
    }

    let csvContent = "Telefone;Nome;Email;Valor\n";

    dataToExport.forEach(row => {
        const clean = (txt) => (txt ? String(txt).replace(/;/g, " ") : "");
        csvContent += `${clean(row.Telefone)};${clean(row.Nome)};${clean(row.Email)};${clean(row.Valor)}\n`;
    });

    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    link.setAttribute("href", url);
    link.setAttribute("download", `Alunos_Ativos_SemStatus_${hoje}.csv`);
    
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

        const valor = item.Valor || '-';
        const responsavel = item.BaixadoPor || '<span style="color:#999; font-style:italic;">Não registrado</span>';

        tr.innerHTML = `
            <td><strong>${dataBaixa}</strong></td>
            <td>${item.Nome}</td>
            <td>${valor}</td>
            <td>${item.OrigemPagamento || '-'}</td>
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
                    </tr>
                </thead>
                <tbody>
        `;

        // Helper para formatar data
        const fmt = (d) => {
            if (!d) return '-';
            const dateObj = d.toDate ? d.toDate() : new Date(d);
            return isNaN(dateObj) ? '-' : dateObj.toLocaleDateString('pt-BR');
        };

        list.forEach(item => {
            table += `
                <tr>
                    <td>${item.Nome || '-'}</td>
                    <td>${item.Email || '-'}</td>
                    <td style="mso-number-format:'@'">${item.CPF || '-'}</td> <td style="mso-number-format:'@'">${item.Telefone || '-'}</td>
                    <td>${item.Curso || '-'}</td>
                    <td>${item.FormaPag || '-'}</td>
                    <td>${item.Valor || '-'}</td>
                    <td>${item.Vencimento || '-'}</td>
                    <td>${fmt(item.Data3Cob)}</td>
                    <td>${fmt(item.Data1Jur)}</td>
                    <td>${fmt(item.DataPagamento)}</td>
                    <td>${item.BaixadoPor || '-'}</td>
                    <td>${item.OrigemPagamento || '-'}</td>
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
    // 1. Pergunta o intervalo
    const horasInput = prompt("Exportar alunos SEM TAG e que NÃO receberam ligação nas últimas X horas:", "3");
    if (horasInput === null) return; 

    const horas = parseFloat(horasInput.replace(',', '.'));
    if (isNaN(horas) || horas < 0) return alert("Digite um número válido.");

    const agora = new Date();
    // Define o corte: Tudo antes de (Agora - 3h) é considerado "antigo"
    const tempoCorte = new Date(agora.getTime() - (horas * 60 * 60 * 1000));

    // 2. Filtra a lista
    const listaParaExportar = window.cobrancaList.filter(aluno => {
        
        // CONDICÃO A: NÃO PODE TER TAG (Status Extra)
        // Se tiver tag (Acordo, Recado, etc), ele já foi tratado -> SAI DA LISTA
        const temTag = aluno.StatusExtra && aluno.StatusExtra.tipo && aluno.StatusExtra.tipo !== "";
        if (temTag) return false; 

        // CONDICÃO B: NÃO PODE TER LOG RECENTE
        const logs = aluno.HistoricoLogs || [];
        
        // Verifica se existe ALGUM log de 'ligacao' feito DEPOIS do tempo de corte
        const teveLigacaoRecente = logs.some(log => {
            if (log.tipo !== 'ligacao') return false;
            const dataLog = new Date(log.timestamp); 
            return dataLog > tempoCorte; // Retorna TRUE se for recente (ex: 1h atrás)
        });

        // Se teve ligação recente -> SAI DA LISTA (já mexeram nele)
        if (teveLigacaoRecente) return false;

        // Se chegou aqui: Não tem Tag E Não tem Ligação Recente -> ENTRA NA LISTA
        return true;
    });

    if (listaParaExportar.length === 0) {
        return alert(`Nenhum aluno pendente encontrado (Sem tag e sem ligação nas últimas ${horas}h).`);
    }

    // 3. Confirmação
    if(!confirm(`Encontrei ${listaParaExportar.length} alunos que não foram trabalhados nas últimas ${horas}h e estão sem tag.\nBaixar Excel?`)) return;

    // 4. Gera Excel
    let table = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="UTF-8"></head>
        <body>
        <table border="1">
            <thead>
                <tr style="background-color: #ff9800; color: white;"> <th>NOME</th>
                    <th>TELEFONE</th>
                    <th>E-MAIL</th>
                    <th>VALOR</th>
                    <th>VENCIMENTO</th>
                    <th>DIAS ATRASO</th>
                    <th>ÚLTIMA AÇÃO (ANTIGA)</th>
                </tr>
            </thead>
            <tbody>
    `;

    listaParaExportar.forEach(item => {
        let ultimaAcaoStr = 'Nunca';
        if (item.UltimaAcao) {
            const d = item.UltimaAcao.toDate ? item.UltimaAcao.toDate() : new Date(item.UltimaAcao);
            ultimaAcaoStr = d.toLocaleString('pt-BR');
        }

        table += `
            <tr>
                <td>${item.Nome || '-'}</td>
                <td style="mso-number-format:'@'">${item.Telefone || '-'}</td>
                <td>${item.Email || '-'}</td>
                <td>${item.Valor || '-'}</td>
                <td>${item.Vencimento || '-'}</td>
                <td>${item.diasAtrasoCalculado || '-'}</td>
                <td>${ultimaAcaoStr}</td>
            </tr>
        `;
    });

    table += `</tbody></table></body></html>`;

    const blob = new Blob([table], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // Nome sugestivo: Pendentes_3h.xls
    const nomeArquivo = `Pendentes_${horas}h_${agora.getHours()}h${agora.getMinutes()}.xls`;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};