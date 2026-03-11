import { getMovimientos, getProductos } from './store';

export interface FunnelMetrics {
  period: '7d' | '30d';
  produccion: number;
  compras: number;
  devoluciones: number;
  totalEntradas: number;
  ventas: number;
  ventasRevenue: number;
  merma: number;
  ajustesSalida: number;
  totalSalidas: number;
  stockActual: number;
  perdidaPct: number;
  ventaPct: number;
  topLoss: { nombre: string; merma: number; produccion: number; pct: number }[];
}

export function computeFunnel(period: '7d' | '30d' = '30d'): FunnelMetrics {
  const now = Date.now();
  const cutoff = now - (period === '7d' ? 7 : 30) * 86400000;
  const movs = getMovimientos().filter(m =>
    m.motivo !== 'anulacion' && m.fecha.toDate().getTime() >= cutoff
  );

  let produccion = 0, compras = 0, devoluciones = 0, ajustesEntrada = 0;
  let ventas = 0, ventasRevenue = 0, merma = 0, ajustesSalida = 0;
  const perProduct = new Map<string, { nombre: string; merma: number; produccion: number }>();

  for (const m of movs) {
    if (m.tipo === 'entrada') {
      switch (m.motivo) {
        case 'cosecha': produccion += m.cantidad; break;
        case 'compra': compras += m.cantidad; break;
        case 'devolucion': devoluciones += m.cantidad; break;
        case 'ajuste': ajustesEntrada += m.cantidad; break;
      }
      if (m.motivo === 'cosecha' || m.motivo === 'compra') {
        const pp = perProduct.get(m.productoId) || { nombre: m.productoNombre, merma: 0, produccion: 0 };
        pp.produccion += m.cantidad;
        perProduct.set(m.productoId, pp);
      }
    } else {
      switch (m.motivo) {
        case 'venta':
          ventas += m.cantidad;
          ventasRevenue += m.precioVenta ?? 0;
          break;
        case 'merma': merma += m.cantidad; break;
        case 'ajuste': ajustesSalida += m.cantidad; break;
      }
      if (m.motivo === 'merma') {
        const pp = perProduct.get(m.productoId) || { nombre: m.productoNombre, merma: 0, produccion: 0 };
        pp.merma += m.cantidad;
        perProduct.set(m.productoId, pp);
      }
    }
  }

  const totalEntradas = produccion + compras + devoluciones + ajustesEntrada;
  const totalSalidas = ventas + merma + ajustesSalida;
  const stockActual = getProductos().reduce((s, p) => s + p.cantidad, 0);

  const topLoss = [...perProduct.values()]
    .filter(p => p.merma > 0)
    .map(p => ({ ...p, pct: p.produccion > 0 ? Math.round(p.merma / p.produccion * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);

  return {
    period,
    produccion, compras, devoluciones,
    totalEntradas,
    ventas, ventasRevenue, merma, ajustesSalida,
    totalSalidas,
    stockActual,
    perdidaPct: totalEntradas > 0 ? Math.round(merma / totalEntradas * 100) : 0,
    ventaPct: totalEntradas > 0 ? Math.round(ventas / totalEntradas * 100) : 0,
    topLoss,
  };
}
