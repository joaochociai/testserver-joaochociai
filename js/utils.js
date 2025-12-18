// js/utils.js

// -----------------------------------------------------
// FORMATAÇÃO DE DATAS
// -----------------------------------------------------
export function formatDate(date) {
    if (!date) return '';
    const d = (date && typeof date.toDate === 'function')
        ? date.toDate()
        : new Date(date);

    return d.toLocaleDateString('pt-BR');
}

export function formatDateUTC(dateInput) {
    if (!dateInput) return '-';

    let d;
    if (dateInput && typeof dateInput.toDate === 'function') {
        d = dateInput.toDate();
    } else {
        d = new Date(dateInput);
    }

    if (isNaN(d.getTime())) return 'Data Inválida';

    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const year = d.getUTCFullYear();

    return `${day}/${month}/${year}`;
}

export function parseDateBR(dateString) {
    if (!dateString) return null;

    const parts = dateString.split('/');
    if (parts.length === 3) {
        return new Date(parts[2], parts[1] - 1, parts[0]);
    }
    return null;
}


// -----------------------------------------------------
// CHAVES DE DATA PARA AGRUPAMENTO DE AGENDAMENTOS
// -----------------------------------------------------
export function getTodayDateKey() {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

export function formatDateKey(dateInput) {
    if (!dateInput) return '';

    const d =
        typeof dateInput.toDate === 'function'
            ? dateInput.toDate()
            : new Date(dateInput);

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();

    return `${day}-${month}-${year}`;
}


// -----------------------------------------------------
// STATUS
// -----------------------------------------------------
export function mapStatusToLabel(status) {
    switch (status) {
        case 'Link enviado': return '🟡 Link enviado';
        case 'Link agendado': return '🟣 Link Agendado';
        case 'Em negociação': return '🟠 Em negociação';
        // ADICIONE AQUI:
        case 'Jurídica': return '⚖️ Jurídica'; 
        default: return status;
    }
}


// -----------------------------------------------------
// MODAIS
// -----------------------------------------------------
export function openModal(title, message) {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-message').innerText = message;

    overlay.classList.remove('modal-hidden');
    overlay.style.display = 'flex';
}

export function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    overlay.style.display = 'none';
}

const Toast = typeof Swal !== 'undefined' ? Swal.mixin({
    toast: true,
    position: 'top-end', // Canto superior direito
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
    didOpen: (toast) => {
        toast.addEventListener('mouseenter', Swal.stopTimer)
        toast.addEventListener('mouseleave', Swal.resumeTimer)
    }
}) : null;

// Expõe globalmente para facilitar o uso
window.showToast = function(title, icon = 'success') {
    if (Toast) {
        Toast.fire({
            icon: icon,
            title: title
        });
    } else {
        console.warn("SweetAlert2 não carregado. Toast:", title);
    }
};

// CONSTANTE DO CICLO (5 SEMANAS)
export const ESCALA_CYCLE = [
    // ÍNDICE 0: SEMANA 1
    { 
        label: "Semana 1 (8h | Trab. Domingo)", 
        carga: "8h", 
        sabado: "Folga", 
        domingo: "08:00 - 18:00" // Horário padrão de domingo (ajustável)
    },
    // ÍNDICE 1: SEMANA 2
    { 
        label: "Semana 2 (6h | Folga FDS 1)", 
        carga: "6h", 
        sabado: "Folga", 
        domingo: "Folga" 
    },
    // ÍNDICE 2: SEMANA 3
    { 
        label: "Semana 3 (8h | Folga FDS 2)", 
        carga: "8h", 
        sabado: "Folga", 
        domingo: "Folga" 
    },
    // ÍNDICE 3: SEMANA 4
    { 
        label: "Semana 4 (6h | Sáb 08h-14h)", 
        carga: "6h", 
        sabado: "08:00 - 14:00", 
        domingo: "Folga" 
    },
    // ÍNDICE 4: SEMANA 5
    { 
        label: "Semana 5 (6h | Sáb 12h-18h)", 
        carga: "6h", 
        sabado: "12:00 - 18:00", 
        domingo: "Folga" 
    }
];

// LÓGICA MATEMÁTICA PARA CALCULAR A SEMANA ATUAL
export function getCycleStage(cycleStartDateStr, targetDateStr) {
    if (!cycleStartDateStr) return null;

    const start = new Date(cycleStartDateStr); // Quando o ciclo começou (Semana 1)
    const target = new Date(targetDateStr);    // A segunda-feira que estamos montando
    
    // Zera horas para evitar erros de fuso horário
    start.setHours(0,0,0,0);
    target.setHours(0,0,0,0);

    // Calcula diferença em milissegundos e converte para semanas
    const diffTime = target - start;
    const diffWeeks = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 7));

    if (diffWeeks < 0) return 0; // Segurança

    // O Operador % (Módulo) faz o loop infinito: 0, 1, 2, 3, 4 -> volta pro 0
    return diffWeeks % 5;
}

// 1. DICIONÁRIO DE NOMES (Apelido na Escala -> Nome Completo no Banco)
export const NAME_MAPPING = {
    // Lado Esquerdo: Como aparece na coluna lateral da escala
    // Lado Direito: Como está salvo no users (Firebase)
    'Júlia': 'Maria Julia Araújo',
    'Gilrêania': 'Gilreânia Paiva', 
    'Gilreania': 'Gilreânia Paiva', // Garantindo sem acento também
    'Mônica': 'Mônica Silva', // Se no banco for Mônica Silva
    'Natália': 'Natália Monteiro',
    'Lorrannye': 'Lorrannye Gaudencio',
    'Dayse': 'Dayse Santos',
    'Fabiana': 'Fabiana Luna',
    'Janny': 'Janny Guimarães',
    'Fernanda': 'Fernanda Xavier',
    'Rozana': 'Rozana Bezerra'
    // Adicione aqui os supervisores se eles tiverem ciclo
    // 'Vanessa': 'Vanessa Feijó', etc...
};

// 2. FUNÇÃO PARA NORMALIZAR TEXTO (Tira acentos e põe minúsculo)
// Ex: "João" -> "joao", "Gilrêania" -> "gilreania"
export function normalizeText(str) {
    if (!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}