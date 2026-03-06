import type { PerfilType, ResultadoType, SegmentoType } from './types';

export const PERFILES: { value: PerfilType; label: string }[] = [
  { value: 'restaurante', label: 'Restaurante' },
  { value: 'hotel', label: 'Hotel' },
  { value: 'bar', label: 'Bar' },
  { value: 'dietetica', label: 'Dietetica' },
  { value: 'revendedor', label: 'Revendedor' },
  { value: 'mercado', label: 'Mercado' },
  { value: 'distribuidor', label: 'Distribuidor' },
  { value: 'feria', label: 'Feria' },
  { value: 'supermercado', label: 'Supermercado' },
  { value: 'comunidad', label: 'Comunidad' },
  { value: 'otro', label: 'Otro' },
];

export const SEGMENTOS: { value: SegmentoType; label: string }[] = [
  { value: 'premium', label: 'Premium' },
  { value: 'medio', label: 'Medio' },
  { value: 'volumen', label: 'Volumen' },
  { value: 'corporativo', label: 'Corporativo' },
];

export const RESULTADOS: { value: ResultadoType; label: string; badge: string }[] = [
  { value: 'pendiente', label: 'Pendiente', badge: 'badge-warning' },
  { value: 'contactado', label: 'Contactado', badge: 'badge-info' },
  { value: 'entrega_prueba', label: 'En prueba', badge: 'badge-purple' },
  { value: 'cliente', label: 'Cliente', badge: 'badge-success' },
  { value: 'no_interesado', label: 'No interesado', badge: 'badge-neutral' },
];

export function getResultadoBadge(resultado: string): { cls: string; label: string } {
  const found = RESULTADOS.find(r => r.value === resultado);
  return found
    ? { cls: found.badge, label: found.label }
    : { cls: 'badge-neutral', label: resultado };
}

export function getPerfilLabel(perfil: string): string {
  const found = PERFILES.find(p => p.value === perfil);
  return found ? found.label : perfil || '--';
}
