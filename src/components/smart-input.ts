// Placeholder — implemented in Fase 5
export function renderSmartInput(container: HTMLElement): (() => void) | null {
  container.innerHTML = `
    <div class="smart-input-bar">
      <input type="text" class="smart-input" placeholder="Decime que queres hacer..." disabled />
      <button class="btn btn-primary btn-sm" disabled>Enviar</button>
    </div>
  `;
  return null;
}
