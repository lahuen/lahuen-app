import { getSuggestions, type Suggestion } from '../lib/suggestions';
import { esc } from '../lib/sanitize';

const ICONS: Record<string, string> = {
  expiry: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff3b30" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  followup: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M16 2v4M8 2v4M4 10h16"/></svg>',
  lowstock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff9500" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  opportunity: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>',
};

export function renderSuggestionsBanner(container: HTMLElement): void {
  if (sessionStorage.getItem('suggestions_dismissed')) return;

  container.innerHTML = '';

  getSuggestions().then(suggestions => {
    if (!suggestions.length) return;
    render(container, suggestions);
  });
}

function render(container: HTMLElement, suggestions: Suggestion[]) {
  container.innerHTML = `
    <div class="suggestions-bar">
      <div class="suggestions-header">
        <span class="suggestions-label">Sugerencias del dia</span>
        <button class="action-btn" id="suggestions-close" title="Cerrar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="suggestions-list">
        ${suggestions.map(s => `
          <div class="suggestion-item">
            <span class="suggestion-icon">${ICONS[s.icon] || ICONS.opportunity}</span>
            <span>${esc(s.text)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  document.getElementById('suggestions-close')!.addEventListener('click', () => {
    sessionStorage.setItem('suggestions_dismissed', '1');
    container.innerHTML = '';
  });
}
