import { collection, addDoc, doc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { esc } from '../lib/sanitize';
import { showToast } from '../lib/toast';
import { logAudit } from '../lib/audit';
import { PERFILES, SEGMENTOS } from '../lib/constants';
import { toInputDate } from '../lib/format';
import type { Prospecto } from '../lib/types';

export function renderCrmForm(container: HTMLElement, prospectoId?: string): (() => void) | null {
  const isEdit = !!prospectoId;

  const perfilOptions = PERFILES.map(p => `<option value="${p.value}">${p.label}</option>`).join('');
  const segmentoOptions = SEGMENTOS.map(s => `<option value="${s.value}">${s.label}</option>`).join('');

  container.innerHTML = `
    <div class="page-narrow">
      <div style="margin-bottom:var(--sp-6); margin-top:var(--sp-4);">
        <h1 class="text-title" id="form-title">${isEdit ? 'Editar prospecto' : 'Nuevo prospecto'}</h1>
        <p class="text-secondary" style="font-size:var(--text-sm);margin-top:2px;">Registra un local o contacto comercial.</p>
      </div>

      <div class="card">
        <form id="prospect-form" class="flex flex-col gap-4">
          <div class="form-group">
            <label class="form-label">Nombre del local *</label>
            <input type="text" name="local" class="form-control" placeholder="Ej: Restaurante El Roble" required />
          </div>

          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Contacto *</label>
              <input type="text" name="contacto" class="form-control" placeholder="Nombre de la persona" required />
            </div>
            <div class="form-group">
              <label class="form-label">WhatsApp *</label>
              <input type="tel" name="whatsapp" class="form-control" placeholder="5491112345678" required />
            </div>
          </div>

          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Perfil *</label>
              <select name="perfil" class="form-control" required>
                <option value="">Seleccionar...</option>
                ${perfilOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Segmento</label>
              <select name="segmento" class="form-control">
                <option value="">Seleccionar...</option>
                ${segmentoOptions}
              </select>
            </div>
          </div>

          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Zona *</label>
              <input type="text" name="zona" class="form-control" placeholder="Ej: Moreno Centro" required />
            </div>
            <div class="form-group">
              <label class="form-label">Direccion</label>
              <input type="text" name="direccion" class="form-control" placeholder="Direccion completa" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Productos de interes</label>
            <input type="text" name="productosInteres" class="form-control" placeholder="lechuga, rucula, albahaca..." />
          </div>

          <div class="form-group">
            <label class="form-label">Notas</label>
            <textarea name="notas" class="form-control" rows="3" placeholder="Comentarios, horarios, etc."></textarea>
          </div>

          <button type="submit" class="btn btn-primary w-full" id="submit-btn">
            ${isEdit ? 'Actualizar prospecto' : 'Guardar prospecto'}
          </button>
          <div id="form-status" style="min-height:36px;"></div>
        </form>
      </div>
    </div>
  `;

  const form = document.getElementById('prospect-form') as HTMLFormElement;
  const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
  const statusEl = document.getElementById('form-status')!;

  // If editing, load existing data
  if (isEdit && prospectoId) {
    loadProspecto(prospectoId);
  }

  async function loadProspecto(id: string) {
    try {
      const snap = await getDoc(doc(db, 'prospectos', id));
      if (!snap.exists()) {
        showToast('Prospecto no encontrado', 'error');
        window.location.hash = '#crm';
        return;
      }
      const data = snap.data() as Prospecto;
      document.getElementById('form-title')!.textContent = 'Editar: ' + esc(data.local);

      (form.local as HTMLInputElement).value = data.local;
      (form.contacto as HTMLInputElement).value = data.contacto;
      (form.whatsapp as HTMLInputElement).value = data.whatsapp;
      (form.perfil as HTMLSelectElement).value = data.perfil;
      (form.segmento as HTMLSelectElement).value = data.segmento || '';
      (form.zona as HTMLInputElement).value = data.zona;
      (form.direccion as HTMLInputElement).value = data.direccion || '';
      (form.productosInteres as HTMLInputElement).value = data.productosInteres || '';
      (form.notas as HTMLTextAreaElement).value = data.notas || '';
    } catch {
      showToast('Error cargando prospecto', 'error');
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }

    submitBtn.disabled = true;
    statusEl.innerHTML = '<div class="status-msg loading">Guardando...</div>';

    const payload = {
      local: (form.local as HTMLInputElement).value.trim(),
      contacto: (form.contacto as HTMLInputElement).value.trim(),
      whatsapp: (form.whatsapp as HTMLInputElement).value.trim(),
      perfil: (form.perfil as HTMLSelectElement).value,
      zona: (form.zona as HTMLInputElement).value.trim(),
      segmento: (form.segmento as HTMLSelectElement).value,
      direccion: (form.direccion as HTMLInputElement).value.trim(),
      productosInteres: (form.productosInteres as HTMLInputElement).value.trim(),
      notas: (form.notas as HTMLTextAreaElement).value.trim(),
      vendedor: auth.currentUser?.email || '',
      updatedAt: Timestamp.now(),
    };

    try {
      if (isEdit && prospectoId) {
        await updateDoc(doc(db, 'prospectos', prospectoId), {
          ...payload,
          updatedBy: auth.currentUser?.email || '',
        });
        logAudit('update', 'prospectos', prospectoId, payload.local);
      } else {
        const ref = await addDoc(collection(db, 'prospectos'), {
          ...payload,
          resultado: 'pendiente',
          fechaVisita: null,
          fechaSeguimiento: null,
          createdAt: Timestamp.now(),
          createdBy: auth.currentUser?.uid || '',
        });
        logAudit('create', 'prospectos', ref.id, payload.local);
      }
      showToast('Prospecto guardado', 'success');
      window.location.hash = '#crm';
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al guardar';
      statusEl.innerHTML = `<div class="status-msg error">${esc(msg)}</div>`;
    } finally {
      submitBtn.disabled = false;
    }
  });

  return null;
}
