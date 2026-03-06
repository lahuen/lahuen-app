import { doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { esc } from '../lib/sanitize';
import { showToast } from '../lib/toast';
import { logAudit } from '../lib/audit';
import { RESULTADOS } from '../lib/constants';
import { toInputDate, todayStr } from '../lib/format';
import type { Prospecto } from '../lib/types';

export function openEstadoModal(prospectoId: string, data: Prospecto): void {
  // Remove existing modal
  document.getElementById('estado-modal')?.remove();

  const optHtml = RESULTADOS.map(r =>
    `<option value="${r.value}"${data.resultado === r.value ? ' selected' : ''}>${r.label}</option>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.id = 'estado-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <h2 class="modal-title">Actualizar estado</h2>
      <p class="modal-subtitle">${esc(data.local)}</p>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Resultado</label>
          <select id="modal-resultado" class="form-control">${optHtml}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Fecha de seguimiento</label>
          <input type="date" id="modal-seguimiento" class="form-control" value="${toInputDate(data.fechaSeguimiento)}" />
        </div>
        <div class="form-group">
          <label class="form-label">Fecha de visita</label>
          <input type="date" id="modal-visita" class="form-control" value="${todayStr()}" />
        </div>
        <div class="form-group">
          <label class="form-label">Notas</label>
          <textarea id="modal-notas" class="form-control" rows="2" placeholder="Agregar nota...">${esc(data.notas || '')}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="modal-cancel">Cancelar</button>
        <button class="btn btn-primary" id="modal-save">Guardar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.getElementById('modal-cancel')!.addEventListener('click', () => overlay.remove());

  document.getElementById('modal-save')!.addEventListener('click', async () => {
    const resultado = (document.getElementById('modal-resultado') as HTMLSelectElement).value;
    const seguimiento = (document.getElementById('modal-seguimiento') as HTMLInputElement).value;
    const visita = (document.getElementById('modal-visita') as HTMLInputElement).value;
    const notas = (document.getElementById('modal-notas') as HTMLTextAreaElement).value;

    overlay.remove();

    try {
      await updateDoc(doc(db, 'prospectos', prospectoId), {
        resultado,
        fechaSeguimiento: seguimiento ? Timestamp.fromDate(new Date(seguimiento + 'T00:00:00')) : null,
        fechaVisita: visita ? Timestamp.fromDate(new Date(visita + 'T00:00:00')) : null,
        notas,
        updatedAt: Timestamp.now(),
        updatedBy: auth.currentUser?.email || '',
      });
      logAudit('update', 'prospectos', prospectoId, data.local, `resultado: ${resultado}`);
      showToast('Estado actualizado', 'success');
    } catch {
      showToast('Error al guardar', 'error');
    }
  });
}
