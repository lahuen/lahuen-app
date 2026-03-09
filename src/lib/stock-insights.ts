import { geminiModel } from './gemini';
import { getProductos, getLotes, getMovimientos } from './store';
import type { Producto, Lote, Movimiento } from './types';

export interface StockInsight {
  icon: 'trend' | 'rotation' | 'alert' | 'recommendation';
  title: string;
  text: string;
  severity: 'info' | 'warning' | 'danger';
}

interface InsightsCache {
  insights: StockInsight[];
  timestamp: number;
  dataHash: string;
}

const CACHE_KEY = 'lahuen_stock_insights';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ── Public API ────────────────────────────────────────────────────────────

export async function getStockInsights(): Promise<StockInsight[]> {
  const context = gatherAnalyticsContext();
  if (!context.hasData) return [];

  const cached = loadCache();
  if (cached && cached.dataHash === context.dataHash && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.insights;
  }

  const insights = await callGemini(context.prompt);
  saveCache({ insights, timestamp: Date.now(), dataHash: context.dataHash });
  return insights;
}

export function clearInsightsCache(): void {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}

// ── Analytics Context ─────────────────────────────────────────────────────

interface AnalyticsContext {
  hasData: boolean;
  dataHash: string;
  prompt: string;
}

function gatherAnalyticsContext(): AnalyticsContext {
  const productos = getProductos();
  const lotes = getLotes();
  const movimientos = getMovimientos();

  if (productos.length === 0) return { hasData: false, dataHash: '0', prompt: '' };

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

  // Aggregate data for prompt
  const trends = computeWeeklyTrends(movimientos);
  const topProducts = computeTopProducts(movimientos, thirtyDaysAgo);
  const stale = computeStaleProducts(productos, movimientos, thirtyDaysAgo);
  const expiring = computeExpiryProjections(lotes, now);

  // Stock summary
  const totalValue = productos.reduce((s, p) => s + p.cantidad * p.precio, 0);
  const zeroStock = productos.filter(p => p.cantidad === 0);
  const lowStock = productos.filter(p => p.cantidad > 0 && p.cantidad < 20);

  const sections: string[] = [];

  sections.push(`RESUMEN: ${productos.length} productos, valor total $${Math.round(totalValue)}`);

  if (zeroStock.length) {
    sections.push(`SIN STOCK (${zeroStock.length}): ${zeroStock.map(p => p.nombre).join(', ')}`);
  }
  if (lowStock.length) {
    sections.push(`STOCK BAJO (${lowStock.length}): ${lowStock.map(p => `${p.nombre}(${p.cantidad})`).join(', ')}`);
  }
  if (expiring.length) {
    sections.push(`LOTES POR VENCER (30d): ${expiring.map(e => `${e.productoNombre} lote ${e.numero}: ${e.cantidad}uds en ${e.diasRestantes}d`).join(', ')}`);
  }
  if (topProducts.length) {
    sections.push(`TOP VENTAS (30d): ${topProducts.map(t => `${t.nombre}: ${t.cantidadVendida} uds`).join(', ')}`);
  }
  if (stale.length) {
    sections.push(`SIN MOVIMIENTO (30d): ${stale.map(p => p.nombre).join(', ')}`);
  }
  if (trends.length >= 2) {
    const recent = trends[trends.length - 1];
    const prev = trends[trends.length - 2];
    sections.push(`TENDENCIA: semana actual ${recent.entradas} entradas/${recent.salidas} salidas, semana anterior ${prev.entradas}/${prev.salidas}`);
  }

  const dataHash = `${productos.length}-${lotes.length}-${movimientos.length}-${zeroStock.length}-${expiring.length}`;

  return {
    hasData: true,
    dataHash,
    prompt: sections.join('\n'),
  };
}

// ── Aggregation Helpers ───────────────────────────────────────────────────

function computeWeeklyTrends(movimientos: (Movimiento & { id: string })[]) {
  const weeks = new Map<string, { entradas: number; salidas: number }>();
  for (const m of movimientos) {
    if (m.motivo === 'anulacion') continue;
    const d = m.fecha.toDate();
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().split('T')[0];
    const w = weeks.get(key) || { entradas: 0, salidas: 0 };
    if (m.tipo === 'entrada') w.entradas += m.cantidad;
    else w.salidas += m.cantidad;
    weeks.set(key, w);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-4)
    .map(([, v]) => v);
}

function computeTopProducts(movimientos: (Movimiento & { id: string })[], since: Date) {
  const sales = new Map<string, { nombre: string; cantidadVendida: number }>();
  for (const m of movimientos) {
    if (m.tipo !== 'salida' || m.motivo === 'anulacion') continue;
    if (m.fecha.toDate() < since) continue;
    const entry = sales.get(m.productoId) || { nombre: m.productoNombre, cantidadVendida: 0 };
    entry.cantidadVendida += m.cantidad;
    sales.set(m.productoId, entry);
  }
  return [...sales.values()].sort((a, b) => b.cantidadVendida - a.cantidadVendida).slice(0, 5);
}

function computeStaleProducts(productos: (Producto & { id: string })[], movimientos: (Movimiento & { id: string })[], since: Date) {
  const activeIds = new Set<string>();
  for (const m of movimientos) {
    if (m.fecha.toDate() >= since) activeIds.add(m.productoId);
  }
  return productos.filter(p => p.cantidad > 0 && !activeIds.has(p.id));
}

function computeExpiryProjections(lotes: (Lote & { id: string })[], now: Date) {
  const thirtyDays = new Date(now.getTime() + 30 * 86400000);
  return lotes
    .filter(l => l.cantidad > 0 && l.vencimiento && l.vencimiento.toDate() <= thirtyDays)
    .map(l => ({
      productoNombre: l.productoNombre,
      numero: l.numero,
      cantidad: l.cantidad,
      diasRestantes: Math.max(0, Math.ceil((l.vencimiento!.toDate().getTime() - now.getTime()) / 86400000)),
    }))
    .sort((a, b) => a.diasRestantes - b.diasRestantes);
}

// ── Gemini Call ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Sos el analista de stock de Lahuen (cooperativa hidroponica argentina).
Analiza los datos y genera insights accionables para el equipo.

Reglas:
- Maximo 5 insights, priorizando urgencia
- Cada insight con titulo corto y detalle breve (1-2 oraciones)
- Cruza datos: si hay stock que vence, sugeri a quien venderlo o que hacer
- Prioriza: riesgos de vencimiento, productos sin stock, oportunidades
- Lenguaje argentino informal y directo
- Responde SOLO con JSON array:
[{"icon":"trend|rotation|alert|recommendation","title":"titulo","text":"detalle","severity":"info|warning|danger"}]

DATOS:
`;

async function callGemini(contextPrompt: string): Promise<StockInsight[]> {
  try {
    const result = await geminiModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: SYSTEM_PROMPT + contextPrompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
    });
    const text = result.response.text();
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return buildFallbackInsights(contextPrompt);
    return JSON.parse(jsonMatch[0]) as StockInsight[];
  } catch {
    return buildFallbackInsights(contextPrompt);
  }
}

function buildFallbackInsights(prompt: string): StockInsight[] {
  const insights: StockInsight[] = [];
  if (prompt.includes('SIN STOCK')) {
    insights.push({ icon: 'alert', title: 'Productos sin stock', text: 'Hay productos agotados que necesitan reposicion.', severity: 'danger' });
  }
  if (prompt.includes('POR VENCER')) {
    insights.push({ icon: 'alert', title: 'Lotes por vencer', text: 'Hay lotes proximos a vencer. Considera liquidarlos o donarlos.', severity: 'warning' });
  }
  if (prompt.includes('STOCK BAJO')) {
    insights.push({ icon: 'recommendation', title: 'Stock bajo', text: 'Algunos productos tienen stock bajo. Planifica reposicion.', severity: 'warning' });
  }
  if (prompt.includes('SIN MOVIMIENTO')) {
    insights.push({ icon: 'rotation', title: 'Productos estancados', text: 'Hay productos con stock sin movimiento reciente.', severity: 'info' });
  }
  return insights;
}

// ── Cache ─────────────────────────────────────────────────────────────────

function loadCache(): InsightsCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveCache(data: InsightsCache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}
