import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './lib/firebase';
import { renderLogin } from './components/login';
import { getUsuario } from './lib/usuarios';
import { esc } from './lib/sanitize';
import './style.css';

const root = document.getElementById('app')!;
let cleanup: (() => void) | null = null;
let currentRole: string | null = null;
let currentNombre: string | null = null;
let layoutReady = false;

// Show loading immediately while Firebase initializes
root.innerHTML = `<div class="empty-state" style="min-height:100vh;"><p>Cargando...</p></div>`;

onAuthStateChanged(auth, async (user) => {
  if (user) {
    const LEGACY_ADMINS = ['cbd.preparados@gmail.com', 'walter.medina.pourcel@gmail.com'];
    try {
      const u = await getUsuario(user.email || '');
      currentRole = u?.role || (LEGACY_ADMINS.includes(user.email || '') ? 'admin' : null);
      currentNombre = u?.nombre || null;
    } catch {
      currentRole = LEGACY_ADMINS.includes(user.email || '') ? 'admin' : null;
      currentNombre = null;
    }
    if (!auth.currentUser) return;

    if (!layoutReady) {
      renderLayout();
      layoutReady = true;
    }
    navigateToHash();
    window.addEventListener('hashchange', navigateToHash);
    import('./lib/notifications').then(({ checkAndNotify }) => checkAndNotify()).catch(() => {});
  } else {
    currentRole = null;
    currentNombre = null;
    layoutReady = false;
    window.removeEventListener('hashchange', navigateToHash);
    if (cleanup) { cleanup(); cleanup = null; }
    renderLogin(root);
  }
});

/** Render the persistent layout (header, nav, containers) — called once */
function renderLayout() {
  const displayName = esc(currentNombre || (auth.currentUser?.email || '').split('@')[0]);

  root.innerHTML = `
    <header class="app-header">
      <div class="app-brand">
        <img src="logo.svg" alt="Lahuen" class="nav-logo" />
        <span>CRM</span>
      </div>
      <button class="hamburger-btn" id="hamburger-btn" aria-label="Menu" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
      <nav class="tab-nav" id="tab-nav">
        <a class="tab" href="#stock" data-tab="#stock">Stock</a>
        <a class="tab" href="#movimientos" data-tab="#movimientos">Movimientos</a>
        <a class="tab" href="#crm" data-tab="#crm">CRM</a>
        <a class="tab" href="#agenda" data-tab="#agenda">Agenda</a>
        <a class="tab" href="#nuevo" data-tab="#nuevo">Nuevo</a>
        ${currentRole === 'admin' ? `<a class="tab" href="#audit" data-tab="#audit">Audit</a>` : ''}
      </nav>
      <div class="nav-user">
        <span class="text-secondary text-xs">${displayName}</span>
        <button class="action-btn" id="logout-btn" title="Salir">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    </header>
    <div id="smart-input-container"></div>
    <div id="suggestions-container"></div>
    <main class="content" id="view">
      <div class="empty-state"><p>Cargando...</p></div>
    </main>
  `;

  document.getElementById('logout-btn')!.addEventListener('click', () => signOut(auth));

  // Hamburger menu
  const hamburger = document.getElementById('hamburger-btn')!;
  const header = document.querySelector('.app-header') as HTMLElement;

  hamburger.addEventListener('click', () => {
    const isOpen = header.classList.toggle('nav-open');
    hamburger.setAttribute('aria-expanded', String(isOpen));
  });

  document.querySelectorAll('.tab-nav .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      header.classList.remove('nav-open');
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });

  document.addEventListener('click', (e) => {
    if (header.classList.contains('nav-open') && !header.contains(e.target as Node)) {
      header.classList.remove('nav-open');
      hamburger.setAttribute('aria-expanded', 'false');
    }
  });

  // Smart input bar
  const smartContainer = document.getElementById('smart-input-container')!;
  import('./components/smart-input').then(({ renderSmartInput }) => renderSmartInput(smartContainer)).catch(() => {});

  // AI suggestions banner (async, non-blocking)
  const suggestionsContainer = document.getElementById('suggestions-container')!;
  import('./components/suggestions-banner').then(({ renderSuggestionsBanner }) => renderSuggestionsBanner(suggestionsContainer)).catch(() => {});
}

/** Navigate: only swap the #view content + update active tab */
function navigateToHash() {
  try {
    if (cleanup) { cleanup(); cleanup = null; }

    const hash = window.location.hash || '#stock';
    const view = document.getElementById('view');
    if (!view) return;

    view.innerHTML = `<div class="empty-state"><p>Cargando...</p></div>`;

    // Update active tab
    document.querySelectorAll('#tab-nav .tab').forEach(tab => {
      const tabHash = (tab as HTMLElement).dataset.tab || '';
      tab.classList.toggle('active', hash === tabHash || (hash.startsWith('#editar/') && tabHash === '#crm'));
    });

    if (hash.startsWith('#editar/')) {
      const id = hash.split('/')[1];
      loadComponent('crm-form', view, id);
    } else {
      switch (hash) {
        case '#nuevo':
          loadComponent('crm-form', view);
          break;
        case '#crm':
          loadComponent('crm-dashboard', view);
          break;
        case '#agenda':
          loadComponent('agenda-dashboard', view);
          break;
        case '#movimientos':
          loadComponent('stock-movimientos', view);
          break;
        case '#audit':
          loadComponent('audit-dashboard', view);
          break;
        default:
          loadComponent('stock-dashboard', view);
          break;
      }
    }
  } catch (err) {
    console.error('navigateToHash error:', err);
    const view = document.getElementById('view');
    if (view) {
      view.innerHTML = `
        <div class="empty-state">
          <p>Error cargando vista</p>
          <button class="btn btn-primary btn-sm" style="margin-top:var(--sp-3);" onclick="location.reload()">Recargar</button>
        </div>
      `;
    }
  }
}

async function loadComponent(name: string, container: HTMLElement, param?: string) {
  try {
    switch (name) {
      case 'crm-dashboard': {
        const { renderCrmDashboard } = await import('./components/crm-dashboard');
        cleanup = renderCrmDashboard(container) || null;
        break;
      }
      case 'crm-form': {
        const { renderCrmForm } = await import('./components/crm-form');
        cleanup = renderCrmForm(container, param) || null;
        break;
      }
      case 'stock-dashboard': {
        const { renderStockDashboard } = await import('./components/stock-dashboard');
        cleanup = renderStockDashboard(container) || null;
        break;
      }
      case 'stock-movimientos': {
        const { renderStockMovimientos } = await import('./components/stock-movimientos');
        cleanup = renderStockMovimientos(container) || null;
        break;
      }
      case 'agenda-dashboard': {
        const { renderAgendaDashboard } = await import('./components/agenda-dashboard');
        cleanup = renderAgendaDashboard(container) || null;
        break;
      }
      case 'audit-dashboard': {
        const { renderAuditDashboard } = await import('./components/audit-dashboard');
        cleanup = renderAuditDashboard(container) || null;
        break;
      }
    }
  } catch (err) {
    console.error('loadComponent error:', err);
    container.innerHTML = `<div class="empty-state"><p>Error cargando vista</p></div>`;
  }
}
