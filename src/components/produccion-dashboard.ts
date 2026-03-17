import { collection, addDoc, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { esc } from '../lib/sanitize';
import { formatDate, toInputDate } from '../lib/format';
import { showToast } from '../lib/toast';
import { logAudit } from '../lib/audit';
import { graduarSiembra } from '../lib/stock';
import { getProductos, getSiembras, subscribe } from '../lib/store';
import type { Siembra } from '../lib/types';

type ActionState = { type: 'cosechar' | 'editar'; id: string } | null;

export function renderProduccionDashboard(container: HTMLElement): (() => void) | null {
  let actionState: ActionState = null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  container.innerHTML = `
    <div class="page">
      <div class="stat-grid" style="margin-bottom:var(--sp-4);">
        <div class="stat-card"><p class="stat-label">Siembras activas</p><p class="stat-value" id="prod-active">--</p></div>
        <div class="stat-card"><p class="stat-label">Plantas en desarrollo</p><p class="stat-value" id="prod-plants">--</p></div>
        <div class="stat-card"><p class="stat-label">Proxima cosecha</p><p class="stat-value text-accent" id="prod-next">--</p></div>
        <div class="stat-card"><p class="stat-label">Cosechadas (mes)</p><p class="stat-value" id="prod-harvested">--</p></div>
      </div>

      <div id="add-siembra-form" style="display:none;margin-bottom:var(--sp-4);">
        <div class="card">
          <h3 class="text-title" style="margin-bottom:var(--sp-4);">Nueva siembra</h3>
          <form id="siembra-form" class="flex flex-col gap-4">
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">Producto *</label>
                <select name="productoId" class="form-control" required id="siembra-producto-sel"></select>
              </div>
              <div class="form-group">
                <label class="form-label">Cantidad sembrada *</label>
                <input type="number" name="cantidad" class="form-control" min="1" required placeholder="Ej: 1000" />
              </div>
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">Fecha siembra</label>
                <input type="date" name="fechaSiembra" class="form-control" />
              </div>
              <div class="form-group">
                <label class="form-label">Estimado cosecha *</label>
                <input type="date" name="estimadoCosecha" class="form-control" required />
              </div>
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">Merma estimada %</label>
                <input type="number" name="mermaEstimada" class="form-control" min="0" max="100" value="5" />
              </div>
              <div class="form-group">
                <label class="form-label">Ubicacion</label>
                <input type="text" name="ubicacion" class="form-control" placeholder="Ej: Cama 3, Invernadero A" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Notas</label>
              <input type="text" name="notas" class="form-control" placeholder="Observaciones (opcional)" />
            </div>
            <div style="display:flex;gap:var(--sp-3);">
              <button type="submit" class="btn btn-primary btn-sm">Guardar</button>
              <button type="button" class="btn btn-secondary btn-sm" id="cancel-siembra">Cancelar</button>
            </div>
          </form>
        </div>
      </div>

      <div class="toolbar">
        <button class="btn btn-primary btn-sm" id="add-siembra-btn">+ Siembra</button>
        <span id="siembra-count" class="badge badge-neutral">--</span>
      </div>

      <div id="siembra-list"></div>

      <div style="margin-top:var(--sp-6);">
        <div class="report-strip" id="history-panel">
          <div class="report-strip-header" id="history-header">
            <span class="report-strip-label">Historial de cosechas</span>
            <svg class="report-strip-chevron" id="history-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M6 9l6 6 6-6"/></svg>
          </div>
          <div class="report-strip-body" id="history-body" style="display:none;">
            <div id="siembra-history"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Toggle add form
  const addBtn = document.getElementById('add-siembra-btn')!;
  const addForm = document.getElementById('add-siembra-form')!;
  addBtn.addEventListener('click', () => {
    addForm.style.display = addForm.style.display === 'none' ? '' : 'none';
    populateProductSelect();
  });
  document.getElementById('cancel-siembra')!.addEventListener('click', () => { addForm.style.display = 'none'; });

  // Set default fecha siembra to today
  const fechaSiembraInput = (document.getElementById('siembra-form') as HTMLFormElement).fechaSiembra as HTMLInputElement;
  fechaSiembraInput.value = new Date().toISOString().split('T')[0];

  // History toggle
  document.getElementById('history-header')!.addEventListener('click', () => {
    const body = document.getElementById('history-body')!;
    const panel = document.getElementById('history-panel')!;
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : '';
    panel.classList.toggle('report-strip-open', !isOpen);
  });

  // Form submit
  const form = document.getElementById('siembra-form') as HTMLFormElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const productoId = (form.productoId as HTMLSelectElement).value;
    const producto = getProductos().find(p => p.id === productoId);
    if (!producto) { showToast('Selecciona un producto', 'error'); return; }

    try {
      const ref = await addDoc(collection(db, 'siembras'), {
        productoId,
        productoNombre: producto.nombre,
        cantidad: Number((form.cantidad as HTMLInputElement).value),
        fechaSiembra: Timestamp.fromDate(new Date((form.fechaSiembra as HTMLInputElement).value + 'T00:00:00')),
        estimadoCosecha: Timestamp.fromDate(new Date((form.estimadoCosecha as HTMLInputElement).value + 'T00:00:00')),
        mermaEstimada: Number((form.mermaEstimada as HTMLInputElement).value) || 5,
        ubicacion: (form.ubicacion as HTMLInputElement).value.trim(),
        estado: 'activa',
        notas: (form.notas as HTMLInputElement).value.trim(),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdBy: auth.currentUser?.uid || '',
      });
      logAudit('create', 'siembras', ref.id, producto.nombre);
      showToast('Siembra registrada', 'success');
      form.reset();
      fechaSiembraInput.value = new Date().toISOString().split('T')[0];
      (form.mermaEstimada as HTMLInputElement).value = '5';
      addForm.style.display = 'none';
    } catch {
      showToast('Error al registrar siembra', 'error');
    }
  });

  // Delegated clicks on siembra list
  document.getElementById('siembra-list')!.addEventListener('click', handleListClick);

  function handleListClick(e: Event) {
    const target = e.target as HTMLElement;

    const cosBtn = target.closest('[data-harvest]') as HTMLElement | null;
    if (cosBtn) {
      const id = cosBtn.dataset.harvest!;
      actionState = actionState?.id === id && actionState.type === 'cosechar' ? null : { type: 'cosechar', id };
      rebuild();
      return;
    }

    const editBtn = target.closest('[data-edit-siembra]') as HTMLElement | null;
    if (editBtn) {
      const id = editBtn.dataset.editSiembra!;
      actionState = actionState?.id === id && actionState.type === 'editar' ? null : { type: 'editar', id };
      rebuild();
      return;
    }

    const cancelBtn = target.closest('[data-cancel-siembra]') as HTMLElement | null;
    if (cancelBtn) {
      cancelSiembra(cancelBtn.dataset.cancelSiembra!);
      return;
    }

    const confirmHarvest = target.closest('[data-confirm-harvest]') as HTMLElement | null;
    if (confirmHarvest) {
      doHarvest(confirmHarvest.dataset.confirmHarvest!);
      return;
    }

    const saveEdit = target.closest('[data-save-edit]') as HTMLElement | null;
    if (saveEdit) {
      doSaveEdit(saveEdit.dataset.saveEdit!);
      return;
    }

    if (target.closest('[data-cancel-action]')) {
      actionState = null;
      rebuild();
    }
  }

  async function cancelSiembra(id: string) {
    try {
      await updateDoc(doc(db, 'siembras', id), {
        estado: 'cancelada',
        updatedAt: Timestamp.now(),
        updatedBy: auth.currentUser?.email || '',
      });
      const s = getSiembras().find(x => x.id === id);
      logAudit('update', 'siembras', id, s?.productoNombre || '', 'cancelada');
      showToast('Siembra cancelada', 'success');
    } catch {
      showToast('Error al cancelar', 'error');
    }
  }

  async function doHarvest(siembraId: string) {
    const form = document.querySelector(`[data-harvest-form="${siembraId}"]`) as HTMLElement | null;
    if (!form) return;
    const qty = Number((form.querySelector('[data-harvest-qty]') as HTMLInputElement).value);
    if (!qty || qty <= 0) { showToast('Ingresa cantidad cosechada', 'error'); return; }

    const s = getSiembras().find(x => x.id === siembraId);
    if (!s) return;

    try {
      await graduarSiembra(siembraId, s.productoId, s.productoNombre, qty, s.ubicacion);
      actionState = null;
      showToast(`Cosecha registrada: +${qty} ${s.productoNombre}`, 'success');
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : 'Error'}`, 'error');
    }
  }

  async function doSaveEdit(siembraId: string) {
    const form = document.querySelector(`[data-edit-form="${siembraId}"]`) as HTMLElement | null;
    if (!form) return;

    const cantidad = Number((form.querySelector('[data-edit-cantidad]') as HTMLInputElement).value);
    const estimadoStr = (form.querySelector('[data-edit-estimado]') as HTMLInputElement).value;
    const merma = Number((form.querySelector('[data-edit-merma]') as HTMLInputElement).value);
    const ubicacion = (form.querySelector('[data-edit-ubicacion]') as HTMLInputElement).value.trim();
    const notas = (form.querySelector('[data-edit-notas]') as HTMLInputElement).value.trim();

    if (!cantidad || cantidad <= 0) { showToast('Cantidad invalida', 'error'); return; }
    if (!estimadoStr) { showToast('Fecha estimada requerida', 'error'); return; }

    try {
      await updateDoc(doc(db, 'siembras', siembraId), {
        cantidad,
        estimadoCosecha: Timestamp.fromDate(new Date(estimadoStr + 'T00:00:00')),
        mermaEstimada: merma,
        ubicacion,
        notas,
        updatedAt: Timestamp.now(),
        updatedBy: auth.currentUser?.email || '',
      });
      const s = getSiembras().find(x => x.id === siembraId);
      logAudit('update', 'siembras', siembraId, s?.productoNombre || '', 'editada');
      actionState = null;
      showToast('Siembra actualizada', 'success');
    } catch {
      showToast('Error al actualizar', 'error');
    }
  }

  function populateProductSelect() {
    const sel = document.getElementById('siembra-producto-sel') as HTMLSelectElement;
    const productos = getProductos();
    sel.innerHTML = productos.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
  }

  const unsub = subscribe(rebuild, ['siembras', 'productos']);
  rebuild();

  function rebuild() {
    const allSiembras = getSiembras();
    const activas = allSiembras.filter(s => s.estado === 'activa');
    const cosechadas = allSiembras.filter(s => s.estado === 'cosechada');
    const now = Date.now();

    // KPIs
    const totalPlants = activas.reduce((sum, s) => sum + s.cantidad, 0);
    let nextDays: number | null = null;
    for (const s of activas) {
      const d = Math.ceil((s.estimadoCosecha.toDate().getTime() - now) / 86400000);
      if (nextDays === null || d < nextDays) nextDays = d;
    }
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const cosechadasMes = cosechadas.filter(s => s.fechaCosecha && s.fechaCosecha.toDate() >= monthStart).length;

    document.getElementById('prod-active')!.textContent = String(activas.length);
    document.getElementById('prod-plants')!.textContent = totalPlants.toLocaleString('es-AR');
    document.getElementById('prod-next')!.textContent = nextDays != null ? (nextDays <= 0 ? 'Hoy!' : `${nextDays}d`) : '--';
    document.getElementById('prod-harvested')!.textContent = String(cosechadasMes);
    document.getElementById('siembra-count')!.textContent = `${activas.length} activas`;

    // Active list
    const listEl = document.getElementById('siembra-list')!;
    if (activas.length === 0) {
      listEl.innerHTML = '<div class="empty-state"><p>Sin siembras activas</p></div>';
    } else {
      listEl.innerHTML = activas.map(s => {
        const cosechaDate = s.estimadoCosecha.toDate();
        const siembraDate = s.fechaSiembra.toDate();
        const totalDays = Math.max(1, (cosechaDate.getTime() - siembraDate.getTime()) / 86400000);
        const elapsedDays = (now - siembraDate.getTime()) / 86400000;
        const progress = Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100));
        const daysLeft = Math.ceil((cosechaDate.getTime() - now) / 86400000);
        const readyToHarvest = daysLeft <= 10;
        const estimatedYield = Math.round(s.cantidad * (1 - s.mermaEstimada / 100));

        const isHarvesting = actionState?.id === s.id && actionState.type === 'cosechar';
        const isEditing = actionState?.id === s.id && actionState.type === 'editar';

        let actionForm = '';
        if (isHarvesting) {
          actionForm = `<div class="siembra-action-form" data-harvest-form="${s.id}">
            <div class="grid-2" style="gap:var(--sp-2);">
              <div class="form-group">
                <label class="form-label">Cantidad cosechada</label>
                <input type="number" class="form-control" data-harvest-qty min="1" value="${estimatedYield}" />
              </div>
              <div style="display:flex;gap:var(--sp-2);align-items:end;">
                <button class="btn btn-sm btn-primary" data-confirm-harvest="${s.id}">Confirmar cosecha</button>
                <button class="btn btn-sm btn-secondary" data-cancel-action>Cancelar</button>
              </div>
            </div>
          </div>`;
        }
        if (isEditing) {
          actionForm = `<div class="siembra-action-form" data-edit-form="${s.id}">
            <div class="grid-2" style="gap:var(--sp-2);">
              <div class="form-group">
                <label class="form-label">Cantidad</label>
                <input type="number" class="form-control" data-edit-cantidad min="1" value="${s.cantidad}" />
              </div>
              <div class="form-group">
                <label class="form-label">Estimado cosecha</label>
                <input type="date" class="form-control" data-edit-estimado value="${toInputDate(s.estimadoCosecha)}" />
              </div>
            </div>
            <div class="grid-2" style="gap:var(--sp-2);">
              <div class="form-group">
                <label class="form-label">Merma %</label>
                <input type="number" class="form-control" data-edit-merma min="0" max="100" value="${s.mermaEstimada}" />
              </div>
              <div class="form-group">
                <label class="form-label">Ubicacion</label>
                <input type="text" class="form-control" data-edit-ubicacion value="${esc(s.ubicacion)}" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Notas</label>
              <input type="text" class="form-control" data-edit-notas value="${esc(s.notas || '')}" />
            </div>
            <div style="display:flex;gap:var(--sp-2);">
              <button class="btn btn-sm btn-primary" data-save-edit="${s.id}">Guardar</button>
              <button class="btn btn-sm btn-secondary" data-cancel-action>Cancelar</button>
            </div>
          </div>`;
        }

        return `<div class="card" style="margin-bottom:var(--sp-3);${readyToHarvest ? 'border-left:3px solid var(--color-accent);' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:var(--sp-2);">
            <div>
              <strong>${esc(s.productoNombre)}</strong>
              <div class="text-xs text-secondary">${s.cantidad} plantas · ${esc(s.ubicacion || 'Sin ubicacion')}${s.notas ? ' · ' + esc(s.notas) : ''}</div>
            </div>
            <span class="badge ${readyToHarvest ? 'badge-success' : 'badge-warning'}">
              ${daysLeft <= 0 ? 'Lista!' : daysLeft + 'd'}
            </span>
          </div>
          <div style="display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-2);">
            <div class="shelf-life-bar" style="flex:1;">
              <div class="shelf-life-fill shelf-life-${readyToHarvest ? 'ok' : 'warning'}" style="width:${progress}%"></div>
            </div>
            <span class="text-xs text-secondary">${Math.round(progress)}%</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="text-xs text-secondary">
              Siembra: ${formatDate(s.fechaSiembra)} · Cosecha est.: ${formatDate(s.estimadoCosecha)} · Rinde est.: ~${estimatedYield} (${s.mermaEstimada}% merma)
            </span>
            <div style="display:flex;gap:var(--sp-1);">
              ${readyToHarvest ? `<button class="btn btn-xs btn-primary" data-harvest="${s.id}">Cosechar</button>` : ''}
              <button class="btn btn-xs btn-secondary" data-edit-siembra="${s.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn btn-xs btn-secondary" data-cancel-siembra="${s.id}" title="Cancelar siembra">&times;</button>
            </div>
          </div>
          ${actionForm}
        </div>`;
      }).join('');
    }

    // History
    const histEl = document.getElementById('siembra-history')!;
    if (cosechadas.length === 0) {
      histEl.innerHTML = '<p class="text-xs text-secondary" style="padding:var(--sp-3);">Sin cosechas registradas</p>';
    } else {
      histEl.innerHTML = cosechadas.slice(0, 20).map(s =>
        `<div style="display:flex;justify-content:space-between;align-items:center;padding:var(--sp-2) 0;border-bottom:1px solid var(--color-border);">
          <div>
            <strong class="text-sm">${esc(s.productoNombre)}</strong>
            <div class="text-xs text-secondary">${esc(s.ubicacion || '')} · ${s.cantidad} sembradas → ${s.cantidadCosechada ?? '?'} cosechadas</div>
          </div>
          <span class="text-xs text-secondary">${s.fechaCosecha ? formatDate(s.fechaCosecha) : '--'}</span>
        </div>`
      ).join('');
    }
  }

  return () => unsub();
}
