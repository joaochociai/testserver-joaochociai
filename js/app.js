// js/app.js
// App central: login, controle de setores, visibilidade de abas

import { auth, db } from "./firebase.js"; 
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ---------- Variáveis globais ----------
window.currentUserRole = "normal";
window.currentUserSectors = []; 

// ---------- Helper: Visibilidade de Setores ----------
function applySectorVisibility(userDocData) {
  const role = (userDocData && userDocData.role) || "normal";
  const sectorsArr = (userDocData && userDocData.sectors) || [];

  window.currentUserRole = role;
  window.currentUserSectors = Array.isArray(sectorsArr) ? sectorsArr : Object.values(sectorsArr || {});
  const isAdmin = role === "admin";

  // 1. MENU LATERAL E BOTÕES
  document.querySelectorAll(".sector-group, .sector-btn").forEach(el => {
    // Ignora se for elemento da Home para não conflitar
    if(el.classList.contains('home-sector-section')) return;

    const sectorName = el.dataset.sector;
    if (!sectorName) {
      el.style.display = "block";
      return;
    }
    if (isAdmin || window.currentUserSectors.includes(sectorName)) {
        el.style.display = "block";
    } else {
        el.style.display = "none";
    }
  });

  // 2. TELA INICIAL
  document.querySelectorAll(".home-sector-section").forEach(section => {
      const sectorName = section.dataset.sector;
      if (isAdmin || window.currentUserSectors.includes(sectorName)) {
          section.style.display = "block";
      } else {
          section.style.display = "none";
      }
  });
}

// ---------- Login ----------
const loginForm = document.getElementById("login-form");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const msg = document.getElementById("login-message");
    
    if (msg) { msg.textContent = "Autenticando..."; msg.style.color = "#007bff"; }

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      console.error("Erro login:", err);
      if (msg) { msg.textContent = "Erro: e-mail ou senha inválidos"; msg.style.color = "#dc3545"; }
    }
  });
}

// ---------- Logout ----------
window.logoutSystem = async function() {
    try {
        await signOut(auth);
        console.log("Usuário deslogado.");
        // Redireciona ou recarrega a página para voltar ao login
        window.location.reload(); 
    } catch (error) {
        console.error("Erro ao sair:", error);
        alert("Erro ao tentar sair. Veja o console.");
    }
};

// ---------- Monitor de Autenticação (O Cérebro) ----------
onAuthStateChanged(auth, async (user) => {
  const loginScreen = document.getElementById("login-screen");
  const appContent = document.getElementById("app-content");

  if (!user) {
    // Deslogado
    if (loginScreen) loginScreen.style.display = "flex";
    if (appContent) appContent.style.display = "none";
    document.body.classList.remove("is-admin");
    return;
  }

  // Logado
  if (loginScreen) loginScreen.style.display = "none";
  if (appContent) appContent.style.display = "block";

  // 1) Busca dados do usuário
  let userDocData = null;
  try {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      userDocData = userSnap.data();
    }
  } catch (err) {
    console.error("Erro ao buscar permissões:", err);
  }

  // === CORREÇÃO AQUI ===
  // Define isAdmin no escopo principal da função, logo após ter os dados
  // Assim ela fica disponível para todos os blocos try/catch abaixo.
  const isAdmin = userDocData?.role === "admin";
  const sectors = userDocData?.sectors || [];

  // 2) Aplica permissões visuais
  applySectorVisibility(userDocData);

  if (isAdmin) {
    document.body.classList.add("is-admin");
  }

  // 3) Carrega os Módulos Dinamicamente
  try {
    // Agenda (Sempre carrega)
    const agendaModule = await import('./agenda.js');
    if (agendaModule?.loadCalendarData) agendaModule.loadCalendarData();

    // COBRANÇA
    if (isAdmin || sectors.includes("cobranca")) {
        const cobrancaModule = await import('./cobranca.js');
        if (cobrancaModule?.loadCobrancaData) cobrancaModule.loadCobrancaData();
        
        // Carrega Módulo de Escala
        await import('./escala.js');
    }

    // JURÍDICO
    if (isAdmin || sectors.includes("juridico")) {
        const juridicoModule = await import('./juridico.js');
        if (juridicoModule?.initJuridicoForm) juridicoModule.initJuridicoForm();
        if (juridicoModule?.loadJuridicoData) juridicoModule.loadJuridicoData();
        
        // Ligações Jurídico
        await import('./juridico_ligacoes.js');
        if (window.loadJuridicoLigacoes) window.loadJuridicoLigacoes();
    }

    // DASHBOARD (Exclusivo Admin)
    if (isAdmin) {
        const dashModule = await import('./dashboard.js');
        // Se a aba já estiver visível (refresh), inicia
        if (document.getElementById('tab-dashboard') && document.getElementById('tab-dashboard').style.display !== 'none') {
            dashModule.initDashboard();
        }
        // Expõe globalmente para o showTab usar depois
        window.initDashboard = dashModule.initDashboard;
    }

  } catch (err) {
    console.error("ERRO ao carregar módulos:", err);
  }

  // 4) ABRE A TELA INICIAL (DASHBOARD) OU HOME
  const homeBtn = document.getElementById("btn-home");
  if (homeBtn) {
      window.showTab('tab-home', homeBtn);
  } else {
      const firstBtn = document.querySelector(".nav-tab.sector-btn:not([style*='display: none'])");
      if (firstBtn) {
          const onclickAttr = firstBtn.getAttribute("onclick");
          if (onclickAttr) {
              const match = onclickAttr.match(/showTab\('([^']+)'/);
              if (match && match[1]) {
                  window.showTab(match[1], firstBtn);
              }
          }
      }
  }
});

// --- FUNÇÃO GLOBAL DE ABAS (COM LAZY LOADING) ---
window.showTab = async function(tabId, clickedButton) {
  // 1. UI
  document.querySelectorAll(".nav-tab").forEach(btn => btn.classList.remove("active"));
  if (clickedButton) clickedButton.classList.add("active");

  document.querySelectorAll(".tab-content").forEach(t => t.classList.add("hidden"));
  const el = document.getElementById(tabId);
  if (el) el.classList.remove("hidden");
  
  // 2. Dashboard Init
  if (tabId === 'tab-dashboard' && window.initDashboard) {
      window.initDashboard();
  }

  if (tabId === 'tab-dash-juridico') {
      // Verifica se a função já foi carregada
      if (typeof window.loadJuridicoDashboard !== 'function') {
          try {
               // Importa o arquivo novo dinamicamente
              const mod = await import('./dashboard_juridico.js');
              // Executa a função principal dele
               if (mod.loadJuridicoDashboard) mod.loadJuridicoDashboard();
          } catch (e) { 
               console.error("Erro ao carregar Dashboard Jurídico:", e); 
          }
      } else {
          // Se já carregou antes, só executa
          window.loadJuridicoDashboard();
        }
    }

  // 3. Histórico Separado
  if (tabId === 'tab-lista-cobranca') {
      if (window.loadCobrancaHistory) window.loadCobrancaHistory();
  }
  
  if (tabId === 'tab-lista-juridico') {
      if (window.loadJuridicoHistory) window.loadJuridicoHistory();
  }

  // 4. Outros Hooks
  if (tabId === 'tab-calendario' && window.loadCalendarData) window.loadCalendarData();
  if (tabId === 'tab-juridico-calendario' && window.loadJuridicoData) window.loadJuridicoData();
  if (tabId === 'tab-juridico-ligacoes' && window.loadJuridicoLigacoes) window.loadJuridicoLigacoes();
  
  if (tabId === 'tab-escala') {
    try {
        // 1. Carrega o módulo se ainda não existe
        if (typeof window.initEscala !== 'function') {
            const escalaModule = await import('./escala.js');
            // Inicializa as configurações globais
            if (escalaModule.initEscala) escalaModule.initEscala();
        } else {
            window.initEscala();
        }

        // 2. --- O PULO DO GATO ---
        // Chama a função que desenha a tabela de leitura (View Mode)
        setTimeout(() => {
            if (typeof window.loadReadOnlyView === 'function') {
                console.log("Carregando visualização de leitura...");
                window.loadReadOnlyView();
            } else {
                console.warn("Função loadReadOnlyView não encontrada.");
            }
        }, 200); // Pequeno delay para garantir que o HTML da aba carregou

    } catch (error) { 
        console.error("Erro escala:", error); 
    }
  }
};

// Funções globais do menu
import { toggleMenu } from './ui.js';
window.toggleMenu = toggleMenu;

// ==============================================================
// 7. INICIALIZAÇÃO DOS CALENDÁRIOS (FLATPICKR)
// ==============================================================
document.addEventListener('DOMContentLoaded', () => {
    if (typeof flatpickr === 'undefined') {
        console.error("Flatpickr não carregado.");
        return;
    }

    const configPT = {
        dateFormat: "d/m/Y",
        locale: "pt",
        allowInput: true,
        disableMobile: "true"
    };

    if (document.getElementById("datepicker-vencimento")) flatpickr("#datepicker-vencimento", configPT);
    if (document.getElementById("datepicker-gerar")) flatpickr("#datepicker-gerar", { ...configPT, minDate: "today" });
    if (document.getElementById("datepicker-juridico")) flatpickr("#datepicker-juridico", configPT);

    if (document.getElementById("filter-start-cobranca")) flatpickr("#filter-start-cobranca", configPT);
    if (document.getElementById("filter-end-cobranca")) flatpickr("#filter-end-cobranca", configPT);
    
    if (document.getElementById("filter-start-juridico")) flatpickr("#filter-start-juridico", configPT);
    if (document.getElementById("filter-end-juridico")) flatpickr("#filter-end-juridico", configPT);

    if (document.getElementById("filter-end-date")) {
        flatpickr("#filter-end-date", {
            ...configPT,
            onChange: function() { 
                if(window.filterList) window.filterList(); 
            }
        });
    }
    
    // 4. Inputs de Data nos Modais (Novo)
    if (document.getElementById("payment-date")) {
        flatpickr("#payment-date", {
            ...configPT,
            dateFormat: "Y-m-d", 
            altInput: true,
            altFormat: "d/m/Y"
        });
    }

    // 5. Filtros do Dashboard (Novo)
    if (document.getElementById("dash-date-start")) flatpickr("#dash-date-start", configPT);
    if (document.getElementById("dash-date-end")) flatpickr("#dash-date-end", configPT);
});
