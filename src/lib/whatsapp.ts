export function openWhatsApp(contacto: string, whatsapp: string, zona: string): void {
  if (!whatsapp) return;

  const phone = whatsapp.replace(/[\s\-+()]/g, '');
  const nombre = contacto || '';
  const z = zona || 'tu zona';

  const msg = `Hola${nombre ? ' ' + nombre : ''}! Soy de *Lahuen*, cooperativa de produccion hidroponica en Moreno.\n\n` +
    `Producimos verduras de hoja y aromaticas sin agroquimicos, con raiz viva.\n\n` +
    `Nuestros productos llegan frescos el mismo dia de cosecha y se mantienen hasta 14 dias.\n\n` +
    `Te puedo acercar una muestra de prueba? Estamos cerca de ${z}.`;

  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
}
