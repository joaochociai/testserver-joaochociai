// js/ui.js
export function showMenusByPermission(perms) {
    // Hide all sector buttons first
    document.querySelectorAll('[data-menu]').forEach(el => el.style.display = 'none');


    // Global menus
    const maps = {
    agendamento: document.querySelector('[data-menu="agendamento"]'),
    historico: document.querySelector('[data-menu="historico"]'),
    cobranca: document.querySelector('[data-menu="cobranca"]'),
    juridico: document.querySelector('[data-menu="juridico"]')
    };


    // Always show agendamento and historico
    if (maps.agendamento) maps.agendamento.style.display = 'block';
    if (maps.historico) maps.historico.style.display = 'block';


    if (perms.sectors && perms.sectors.includes('cobranca') && maps.cobranca) maps.cobranca.style.display = 'block';
    if (perms.sectors && perms.sectors.includes('juridico') && maps.juridico) maps.juridico.style.display = 'block';
}


export function loadModulesBySector(perms) {
    // Always load agenda module
    import('./agenda.js');


    if (perms.sectors && perms.sectors.includes('cobranca')) import('./cobranca.js');
    if (perms.sectors && perms.sectors.includes('juridico')) import('./juridico.js');
}


// Optional hook executed after auth finished and modules loaded
export function initAfterAuth() {
    // if you need to run some UI init after modules are present
    // e.g. select first visible tab
    const firstVisibleTab = document.querySelector('.nav-tab:not([style*="display: none"])');
    if (firstVisibleTab) {
    const onclickAttr = firstVisibleTab.getAttribute('onclick');
        if (onclickAttr) {
        const tabId = onclickAttr.split("'")[1];
        window.showTab && window.showTab(tabId, firstVisibleTab);
        }
    }
}

export function toggleMenu(menuId) {
    const content = document.getElementById(menuId);
    if (!content) return;
    
    const header = content.previousElementSibling; // O botão que foi clicado
    
    // Alterna a visibilidade
    if (content.classList.contains('menu-open')) {
        content.classList.remove('menu-open');
        if(header) header.classList.remove('active');
    } else {
        content.classList.add('menu-open');
        if(header) header.classList.add('active');
    }
}