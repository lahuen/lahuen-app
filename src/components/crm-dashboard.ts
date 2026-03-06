import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { esc } from '../lib/sanitize';
import { getResultadoBadge, getPerfilLabel } from '../lib/constants';
import { seguimientoLabel, isOverdue } from '../lib/format';
import { openWhatsApp } from '../lib/whatsapp';
import { openEstadoModal } from './crm-estado-modal';
import type { Prospecto } from '../lib/types';

export function renderCrmDashboard(container: HTMLElement): (() => void) | null {
  let allItems: (Prospecto & { id: string })[] = [];

  container.innerHTML = `
    <div class="page">
      <div class="stat-grid" id="kpi-grid" style="margin-bottom:var(--sp-5);">
        <div class="stat-card"><p class="stat-label">Pendientes</p><p class="stat-value text-warning" id="stat-pendiente">--</p></div>
        <div class="stat-card"><p class="stat-label">Contactados</p><p class="stat-value text-accent" id="stat-contactado">--</p></div>
        <div class="stat-card"><p class="stat-label">En prueba</p><p class="stat-value" id="stat-prueba" style="color:#7c3aed;">--</p></div>
        <div class="stat-card"><p class="stat-label">Clientes</p><p class="stat-value text-success" id="stat-cliente">--</p></div>
        <div class="stat-card"><p class="stat-label">Conversion</p><p class="stat-value" id="stat-conversion">--</p></div>
      </div>

      <div class="toolbar">
        <div class="search-wrap">
          <svg class="search-icon" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" class="search-input" placeholder="Buscar local, contacto, zona..." id="crm-search" />
        </div>
        <select class="filter-select" id="crm-filter-resultado">
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="contactado">Contactado</option>
          <option value="entrega_prueba">En prueba</option>
          <option value="cliente">Cliente</option>
          <option value="no_interesado">No interesado</option>
        </select>
        <select class="filter-select" id="crm-filter-vendedor">
          <option value="">Todos los vendedores</option>
        </select>
        <span id="crm-count" class="badge badge-neutral">-- prospectos</span>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Local</th>
              <th>Contacto</th>
              <th>Perfil</th>
              <th>Zona</th>
              <th>Resultado</th>
              <th>Seguimiento</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="crm-tbody">
            <tr><td colspan="7" class="empty-state"><p>Cargando...</p></td></tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile cards view -->
      <div class="crm-cards" id="crm-cards"></div>
    </div>
  `;

  const searchEl = document.getElementById('crm-search') as HTMLInputElement;
  const filterResultado = document.getElementById('crm-filter-resultado') as HTMLSelectElement;
  const filterVendedor = document.getElementById('crm-filter-vendedor') as HTMLSelectElement;

  searchEl.addEventListener('input', applyFilters);
  filterResultado.addEventListener('change', applyFilters);
  filterVendedor.addEventListener('change', applyFilters);

  const q = query(collection(db, 'prospectos'), orderBy('createdAt', 'desc'));
  const unsub = onSnapshot(q, (snap) => {
    allItems = snap.docs.map(d => ({ id: d.id, ...d.data() } as Prospecto & { id: string }));
    populateVendedorFilter();
    applyFilters();
  });

  function populateVendedorFilter() {
    const seen = new Set<string>();
    const vendedores: string[] = [];
    for (const item of allItems) {
      if (item.vendedor && !seen.has(item.vendedor)) {
        seen.add(item.vendedor);
        vendedores.push(item.vendedor);
      }
    }
    filterVendedor.innerHTML = '<option value="">Todos los vendedores</option>' +
      vendedores.map(v => `<option value="${esc(v)}">${esc(v.split('@')[0])}</option>`).join('');
  }

  function applyFilters() {
    const q = (searchEl.value || '').toLowerCase();
    const res = filterResultado.value;
    const vend = filterVendedor.value;

    const filtered = allItems.filter(i => {
      if (!res && i.resultado === 'no_interesado') return false;
      if (q && !i.local.toLowerCase().includes(q) && !i.contacto.toLowerCase().includes(q) &&
          !i.zona.toLowerCase().includes(q) && !(i.notas || '').toLowerCase().includes(q) &&
          !(i.whatsapp || '').includes(q)) return false;
      if (res && i.resultado !== res) return false;
      if (vend && i.vendedor !== vend) return false;
      return true;
    });

    renderTable(filtered);
    renderCards(filtered);
    updateStats();
  }

  function updateStats() {
    const pendiente = allItems.filter(i => i.resultado === 'pendiente').length;
    const contactado = allItems.filter(i => i.resultado === 'contactado').length;
    const prueba = allItems.filter(i => i.resultado === 'entrega_prueba').length;
    const cliente = allItems.filter(i => i.resultado === 'cliente').length;
    const active = allItems.filter(i => i.resultado !== 'no_interesado').length;
    const rate = active > 0 ? Math.round((cliente / active) * 100) : 0;

    document.getElementById('stat-pendiente')!.textContent = String(pendiente);
    document.getElementById('stat-contactado')!.textContent = String(contactado);
    document.getElementById('stat-prueba')!.textContent = String(prueba);
    document.getElementById('stat-cliente')!.textContent = String(cliente);
    document.getElementById('stat-conversion')!.textContent = rate + '%';
  }

  function renderTable(items: (Prospecto & { id: string })[]) {
    const tbody = document.getElementById('crm-tbody')!;
    document.getElementById('crm-count')!.textContent = items.length + ' prospectos';

    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><p>Sin prospectos</p><p style="margin-top:var(--sp-2);"><a href="#nuevo" class="btn btn-primary btn-sm">+ Agregar primer prospecto</a></p></td></tr>';
      return;
    }

    tbody.innerHTML = items.map(i => {
      const badge = getResultadoBadge(i.resultado);
      const seg = seguimientoLabel(i.fechaSeguimiento, i.resultado);
      const overdue = i.resultado !== 'cliente' && i.resultado !== 'no_interesado' && isOverdue(i.fechaSeguimiento);
      const cls = i.resultado === 'no_interesado' ? 'row-faded' : (overdue ? 'row-overdue' : '');

      return `<tr class="${cls}" data-id="${i.id}">
        <td class="td-name">${esc(i.local)}</td>
        <td>${esc(i.contacto)}${i.whatsapp ? `<br><span class="text-tertiary text-xs">${esc(i.whatsapp)}</span>` : ''}</td>
        <td><span class="badge badge-neutral">${esc(getPerfilLabel(i.perfil))}</span></td>
        <td class="text-secondary">${esc(i.zona)}</td>
        <td><span class="badge ${badge.cls}">${badge.label}</span></td>
        <td><span class="${seg.cls}" style="font-weight:${seg.cls.includes('danger') || seg.cls.includes('warning') ? '600' : '400'}">${seg.text}</span></td>
        <td><div class="row-actions">
          ${i.whatsapp ? `<button class="action-btn wa" data-action="wa" data-id="${i.id}" title="WhatsApp"><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg></button>` : ''}
          <button class="action-btn" data-action="edit" data-id="${i.id}" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="action-btn" data-action="estado" data-id="${i.id}" title="Estado" style="color:var(--color-accent);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg></button>
        </div></td>
      </tr>`;
    }).join('');

    // Event delegation
    tbody.addEventListener('click', handleRowAction);
  }

  function renderCards(items: (Prospecto & { id: string })[]) {
    const cardsEl = document.getElementById('crm-cards')!;
    if (items.length === 0) { cardsEl.innerHTML = ''; return; }

    cardsEl.innerHTML = items.map(i => {
      const badge = getResultadoBadge(i.resultado);
      const seg = seguimientoLabel(i.fechaSeguimiento, i.resultado);
      const overdue = i.resultado !== 'cliente' && i.resultado !== 'no_interesado' && isOverdue(i.fechaSeguimiento);
      const cls = i.resultado === 'no_interesado' ? 'row-faded' : (overdue ? 'row-overdue' : '');

      return `<div class="crm-card ${cls}" data-id="${i.id}">
        <div class="crm-card-header">
          <strong>${esc(i.local)}</strong>
          <span class="badge ${badge.cls}">${badge.label}</span>
        </div>
        <div class="crm-card-body">
          <div class="text-xs">${esc(i.contacto)}${i.whatsapp ? ' &middot; ' + esc(i.whatsapp) : ''}</div>
          <div class="text-xs text-secondary"><span class="badge badge-neutral" style="font-size:10px;">${esc(getPerfilLabel(i.perfil))}</span> &middot; ${esc(i.zona)}</div>
          <div class="text-xs"><span class="${seg.cls}" style="font-weight:${seg.cls.includes('danger') || seg.cls.includes('warning') ? '600' : '400'}">Seguimiento: ${seg.text}</span></div>
          ${i.updatedBy ? `<div class="text-xs text-tertiary" style="margin-top:2px;">Editado por ${esc(i.updatedBy.split('@')[0])}</div>` : ''}
        </div>
        <div class="crm-card-actions">
          ${i.whatsapp ? `<button class="action-btn wa" data-action="wa" data-id="${i.id}" title="WhatsApp"><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg></button>` : ''}
          <button class="action-btn" data-action="edit" data-id="${i.id}" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="action-btn" data-action="estado" data-id="${i.id}" title="Estado" style="color:var(--color-accent);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg></button>
        </div>
      </div>`;
    }).join('');

    cardsEl.addEventListener('click', handleRowAction);
  }

  function handleRowAction(e: Event) {
    const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id!;
    const item = allItems.find(i => i.id === id);
    if (!item) return;

    switch (action) {
      case 'wa':
        openWhatsApp(item.contacto, item.whatsapp, item.zona);
        break;
      case 'edit':
        window.location.hash = `#editar/${id}`;
        break;
      case 'estado':
        openEstadoModal(id, item);
        break;
    }
  }

  return () => unsub();
}
