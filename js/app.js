// js/app.js
// App central: controle de setores, visibilidade de abas, carregamento de módulos

import { auth, db } from "./firebase.js";
import './auth.js'; // Ativa o motor de segurança e inatividade
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let currentTabId = null;

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
    if(el.classList.contains('home-sector-section')) return;
    const sectorName = el.dataset.sector;
    if (!sectorName) { el.style.display = "block"; return; }
    el.style.display = (isAdmin || window.currentUserSectors.includes(sectorName)) ? "block" : "none";
  });

  // 2. TELA INICIAL
  document.querySelectorAll(".home-sector-section").forEach(section => {
      const sectorName = section.dataset.sector;
      section.style.display = (isAdmin || window.currentUserSectors.includes(sectorName)) ? "block" : "none";
  });
}

// ---------- Logout Manual ----------
window.logoutSystem = async function() {
    try {
        sessionStorage.removeItem("SESSION_ACTIVE_FLAG");
        await signOut(auth);
        window.location.reload(); 
    } catch (error) {
        console.error("Erro ao sair:", error);
    }
};

window.updateHomeHeader = function() {
    const userNameElement = document.getElementById('home-user-name');
    const relogio = document.getElementById('live-clock');
    const dataElement = document.getElementById('live-date');

    // 1. Atualiza o nome se o dado existir
    if (userNameElement && window.userDocData?.Nome) {
        userNameElement.textContent = window.userDocData.Nome.split(' ')[0];
    }

    // 2. Inicia o relógio se os elementos estiverem na tela
    if (relogio && dataElement) {
        const atualizar = () => {
            const agora = new Date();
            relogio.textContent = agora.toLocaleTimeString('pt-BR');
            dataElement.textContent = agora.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric'
            });
        };
        atualizar();
        setInterval(atualizar, 1000); // Atualiza a cada segundo
    }
};

// ---------- Monitor de Autenticação (O Cérebro) ----------
onAuthStateChanged(auth, async (user) => {
  const loginScreen = document.getElementById("login-screen");
  const appContent = document.getElementById("app-content");

  if (!user) {
    if (loginScreen) loginScreen.style.display = "flex";
    if (appContent) appContent.style.display = "none";
    document.body.classList.remove("is-admin");
    return;
  }

  if (loginScreen) loginScreen.style.display = "none";
  if (appContent) appContent.style.display = "block";

  // 1) Busca dados do usuário
  let userDocData = null;
  try {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      userDocData = userSnap.data();
      
      // --- INSERÇÃO AQUI ---
      window.userDocData = userDocData; // Torna global para o cabeçalho usar
      if (window.updateHomeHeader) window.updateHomeHeader(); // Dispara a atualização
      // ---------------------
    }
  } catch (err) {
    console.error("Erro ao buscar permissões:", err);
  }

  const isAdmin = userDocData?.role === "admin";
  const sectors = userDocData?.sectors || [];

  // 2) Aplica permissões visuais
  applySectorVisibility(userDocData);
  if (isAdmin) document.body.classList.add("is-admin");

  // 3) Carrega os Módulos Dinamicamente (Lazy Loading)
  try {
    const agendaModule = await import('./agenda.js');
    if (agendaModule?.loadCalendarData) agendaModule.loadCalendarData();

    if (isAdmin) {
    const userModule = await import('./usuarios.js');
    window.loadUserListData = userModule.loadUserListData;
    }

    if (isAdmin || sectors.includes("cobranca")) {
        const cobrancaModule = await import('./cobranca.js');
        if (cobrancaModule?.loadCobrancaData) cobrancaModule.loadCobrancaData();
        await import('./escala.js');
    }

    if (isAdmin || sectors.includes("juridico")) {
        const juridicoModule = await import('./juridico.js');
        if (juridicoModule?.initJuridicoForm) juridicoModule.initJuridicoForm();
        if (juridicoModule?.loadJuridicoData) juridicoModule.loadJuridicoData();
        await import('./juridico_ligacoes.js');
        if (window.loadJuridicoLigacoes) window.loadJuridicoLigacoes();
    }

    if (isAdmin) {
        const dashModule = await import('./dashboard.js');
        if (document.getElementById('tab-dashboard')?.style.display !== 'none') {
            dashModule.initDashboard();
        }
        window.initDashboard = dashModule.initDashboard;
    }

    if (isAdmin || sectors.includes("disparos")) {
    try {
        const disparosModule = await import('./disparos.js');
        // Carrega os dados iniciais se a função existir
        if (disparosModule?.loadDisparosData) {
            disparosModule.loadDisparosData();
        }
    } catch (err) {
        console.error("Erro ao carregar módulo de Disparos:", err);
    }
    }
  } catch (err) {
    console.error("ERRO ao carregar módulos:", err);
  }

  // 4) Abre a aba inicial
  const homeBtn = document.getElementById("btn-home");
  if (homeBtn) window.showTab('tab-home', homeBtn);
});

// --- FUNÇÃO GLOBAL DE ABAS (COM LAZY LOADING) ---
window.showTab = async function(tabId, clickedButton) {
  // Limpeza antes de trocar de abas
  if (currentTabId === 'tab-dashboard' && window.stopDashboard) {
      window.stopDashboard(); // Para os listeners do Dashboard
  }
  currentTabId = tabId;
  
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
            console.log("Executando renderização padrão...");
            window.loadReadOnlyView(); // Dispara a visualização
        }
        }, 300);

    } catch (error) { 
        console.error("Erro escala:", error); 
    }
  }

  if (tabId === 'tab-disparos-registros') {
    if (typeof window.loadDisparosData === 'function') {
        window.loadDisparosData();
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

    if (document.getElementById("quick-disparo-data")) {
    flatpickr("#quick-disparo-data", {
        ...configPT,
        // Opcional: permitir datas passadas para registros retroativos
        defaultDate: "today" 
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