import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './lib/firebase';
import { renderLogin } from './components/login';
import { esc } from './lib/sanitize';
import './style.css';

const root = document.getElementById('app')!;
let cleanup: (() => void) | null = null;

onAuthStateChanged(auth, (user) => {
  if (user) {
    renderApp();
    window.addEventListener('hashchange', renderApp);
  } else {
    window.removeEventListener('hashchange', renderApp);
    if (cleanup) { cleanup(); cleanup = null; }
    renderLogin(root);
  }
});

function renderApp() {
  if (cleanup) { cleanup(); cleanup = null; }

  const hash = window.location.hash || '#stock';
  const email = auth.currentUser?.email || '';
  const userName = esc(email.split('@')[0]);

  root.innerHTML = `
    <header class="app-header">
      <div class="app-brand">
        <img src="logo.svg" alt="Lahuen" class="nav-logo" />
        <span>CRM</span>
      </div>
      <nav class="tab-nav">
        <a class="tab ${hash === '#stock' ? 'active' : ''}" href="#stock">Stock</a>
        <a class="tab ${hash === '#movimientos' ? 'active' : ''}" href="#movimientos">Movimientos</a>
        <a class="tab ${hash === '#crm' ? 'active' : ''}" href="#crm">CRM</a>
        <a class="tab ${hash === '#nuevo' ? 'active' : ''}" href="#nuevo">Nuevo</a>
      </nav>
      <div class="nav-user">
        <span class="text-secondary text-xs">${userName}</span>
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
    <main class="content" id="view">
      <div class="empty-state"><p>Cargando...</p></div>
    </main>
  `;

  document.getElementById('logout-btn')!.addEventListener('click', () => signOut(auth));

  // Smart input bar
  const smartContainer = document.getElementById('smart-input-container')!;
  import('./components/smart-input').then(({ renderSmartInput }) => renderSmartInput(smartContainer));

  const view = document.getElementById('view')!

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
      case '#movimientos':
        loadComponent('stock-movimientos', view);
        break;
      default:
        loadComponent('stock-dashboard', view);
        break;
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
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error cargando vista</p></div>`;
  }
}
