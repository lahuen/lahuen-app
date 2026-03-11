import { doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs, Timestamp } from 'firebase/firestore';
import { db, auth } from './firebase';
import { geminiModel, checkRateLimit } from './gemini';
import { getProductos, getLotes, getMovimientos, getProspectos } from './store';
import { computeAllProductMetrics } from './stock-metrics';
import { isOverdue } from './format';
import type { Producto, Lote, Movimiento } from './types';

// ── Types ────────────────────────────────────────────────────────────────

export interface StockInsight {
  icon: 'trend' | 'rotation' | 'alert' | 'recommendation';
  title: string;
  text: string;
  severity: 'info' | 'warning' | 'danger';
}

export interface Suggestion {
  icon: 'expiry' | 'followup' | 'lowstock' | 'opportunity';
  text: string;
}

export interface ProductSummary {
  productoId: string;
  nombre: string;
  cantidad: number;
  weeklyVelocity: number;
  daysToStockout: number | null;
}

export interface ReportMetrics {
  totalProducts: number;
  totalUnits: number;
  totalValue: number;
  zeroStockCount: number;
  lowStockCount: number;
  expiringLotesCount: number;
  expiredLotesCount: number;
  entradasUnits7d: number;
  salidasUnits7d: number;
  ventasUnits7d: number;
  ventasValue7d: number;
  productSummaries: ProductSummary[];
}

export interface SnapshotDelta {
  daysBetween: number;
  totalValueChange: number;
  totalValueChangePct: number;
  totalUnitsChange: number;
  zeroStockChange: number;
  expiringChange: number;
  ventasValueChange: number;
  productChanges: { nombre: string; cantidadChange: number; status: 'improving' | 'stable' | 'worsening' }[];
}

export interface StockReport {
  date: string;
  timestamp: unknown; // Firestore Timestamp
  createdBy: string;
  metrics: ReportMetrics;
  insights: StockInsight[];
  suggestions: Suggestion[];
  deltaComment: string | null;
  delta: SnapshotDelta | null;
}

// ── Constants ────────────────────────────────────────────────────────────

const COLLECTION = 'stock_reports';
const LOCAL_CACHE_KEY = 'lahuen_stock_report';
const LOCAL_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const DAY_MS = 86400000;

// ── Public API ───────────────────────────────────────────────────────────

export async function getStockReport(): Promise<StockReport | null> {
  const productos = getProductos();
  if (productos.length === 0) return null;

  const today = todayDate();

  // 1. Check localStorage cache first
  const localCached = loadLocalCache();
  if (localCached && localCached.date === today) return localCached;

  // 2. Check Firestore for today's report
  try {
    const docRef = doc(db, COLLECTION, today);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const report = snap.data() as StockReport;
      saveLocalCache(report);
      return report;
    }
  } catch (e) {
    console.error('getStockReport: Firestore read failed', e);
  }

  // 3. Generate new report
  return generateReport(today);
}

export async function refreshStockReport(): Promise<StockReport | null> {
  clearLocalCache();
  const today = todayDate();
  return generateReport(today);
}

// ── Report Generation ────────────────────────────────────────────────────

async function generateReport(today: string): Promise<StockReport | null> {
  const metrics = captureMetrics();
  if (metrics.totalProducts === 0) return null;

  // Load previous report for delta
  let prevReport: StockReport | null = null;
  let delta: SnapshotDelta | null = null;
  try {
    prevReport = await loadPreviousReport(today);
    if (prevReport) {
      delta = computeDelta(metrics, prevReport.metrics, today, prevReport.date);
    }
  } catch { /* first report, no delta */ }

  // Build context and call Gemini
  const stockContext = gatherStockContext(metrics);
  const crmContext = gatherCrmContext();
  const deltaContext = delta ? buildDeltaContext(delta) : '';

  let insights: StockInsight[];
  let suggestions: Suggestion[];
  let deltaComment: string | null = null;

  if (checkRateLimit()) {
    try {
      const result = await callGemini(stockContext, crmContext, deltaContext);
      insights = result.insights;
      suggestions = result.suggestions;
      deltaComment = result.deltaComment;
    } catch {
      insights = buildFallbackInsights(stockContext);
      suggestions = buildFallbackSuggestions(crmContext);
    }
  } else {
    insights = buildFallbackInsights(stockContext);
    suggestions = buildFallbackSuggestions(crmContext);
  }

  const report: StockReport = {
    date: today,
    timestamp: Timestamp.now(),
    createdBy: auth.currentUser?.uid || '',
    metrics,
    insights,
    suggestions,
    deltaComment,
    delta,
  };

  // Save to Firestore (fire-and-forget)
  saveToFirestore(report).catch(() => {});

  // Cache locally
  saveLocalCache(report);

  // Clean old localStorage keys from removed modules
  cleanOldCaches();

  return report;
}

// ── Metrics Capture ──────────────────────────────────────────────────────

function captureMetrics(): ReportMetrics {
  const productos = getProductos();
  const lotes = getLotes();
  const movimientos = getMovimientos();
  const metricsMap = computeAllProductMetrics();
  const now = Date.now();
  const sevenDaysAgo = now - 7 * DAY_MS;
  const sevenDaysFromNow = now + 7 * DAY_MS;

  let entradasUnits7d = 0;
  let salidasUnits7d = 0;
  let ventasUnits7d = 0;
  let ventasValue7d = 0;
  const priceMap = new Map<string, number>();
  for (const p of productos) priceMap.set(p.id, p.precio);

  for (const m of movimientos) {
    if (m.motivo === 'anulacion') continue;
    if (m.fecha.toDate().getTime() < sevenDaysAgo) continue;
    if (m.tipo === 'entrada') {
      entradasUnits7d += m.cantidad;
    } else {
      salidasUnits7d += m.cantidad;
      if (m.motivo === 'venta') {
        ventasUnits7d += m.cantidad;
        ventasValue7d += m.cantidad * (priceMap.get(m.productoId) || 0);
      }
    }
  }

  let expiringLotesCount = 0;
  let expiredLotesCount = 0;
  for (const l of lotes) {
    if (l.cantidad <= 0 || !l.vencimiento) continue;
    const vTime = l.vencimiento.toDate().getTime();
    if (vTime <= now) expiredLotesCount++;
    else if (vTime <= sevenDaysFromNow) expiringLotesCount++;
  }

  const productSummaries: ProductSummary[] = productos.map(p => {
    const m = metricsMap.get(p.id);
    return {
      productoId: p.id,
      nombre: p.nombre,
      cantidad: p.cantidad,
      weeklyVelocity: m?.weeklyVelocity ?? 0,
      daysToStockout: m?.daysToStockout ?? null,
    };
  });

  return {
    totalProducts: productos.length,
    totalUnits: productos.reduce((s, p) => s + p.cantidad, 0),
    totalValue: productos.reduce((s, p) => s + p.cantidad * p.precio, 0),
    zeroStockCount: productos.filter(p => p.cantidad === 0).length,
    lowStockCount: productos.filter(p => p.cantidad > 0 && p.cantidad < 20).length,
    expiringLotesCount,
    expiredLotesCount,
    entradasUnits7d,
    salidasUnits7d,
    ventasUnits7d,
    ventasValue7d,
    productSummaries,
  };
}

// ── Delta Computation ────────────────────────────────────────────────────

function computeDelta(current: ReportMetrics, previous: ReportMetrics, currentDate: string, previousDate: string): SnapshotDelta {
  const daysBetween = Math.max(1, Math.round(
    (new Date(currentDate).getTime() - new Date(previousDate).getTime()) / DAY_MS
  ));

  const prevMap = new Map<string, ProductSummary>();
  for (const ps of previous.productSummaries) prevMap.set(ps.productoId, ps);

  const productChanges: SnapshotDelta['productChanges'] = [];
  for (const ps of current.productSummaries) {
    const prev = prevMap.get(ps.productoId);
    if (!prev) continue;
    const change = ps.cantidad - prev.cantidad;
    if (change !== 0) {
      productChanges.push({
        nombre: ps.nombre,
        cantidadChange: change,
        status: change > 0 ? 'improving' : 'worsening',
      });
    }
  }

  // Sort by absolute change descending, take top 5
  productChanges.sort((a, b) => Math.abs(b.cantidadChange) - Math.abs(a.cantidadChange));
  productChanges.splice(5);

  const prevValue = previous.totalValue || 1; // avoid division by zero
  return {
    daysBetween,
    totalValueChange: current.totalValue - previous.totalValue,
    totalValueChangePct: Math.round(((current.totalValue - previous.totalValue) / prevValue) * 100),
    totalUnitsChange: current.totalUnits - previous.totalUnits,
    zeroStockChange: current.zeroStockCount - previous.zeroStockCount,
    expiringChange: current.expiringLotesCount - previous.expiringLotesCount,
    ventasValueChange: current.ventasValue7d - previous.ventasValue7d,
    productChanges,
  };
}

// ── Context Builders (for Gemini prompt) ─────────────────────────────────

function gatherStockContext(metrics: ReportMetrics): string {
  const productos = getProductos();
  const lotes = getLotes();
  const movimientos = getMovimientos();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

  const sections: string[] = [];

  sections.push(`RESUMEN: ${metrics.totalProducts} productos, ${metrics.totalUnits} unidades, valor total $${Math.round(metrics.totalValue)}`);

  // Zero stock
  const zeroStock = productos.filter(p => p.cantidad === 0);
  if (zeroStock.length) {
    sections.push(`SIN STOCK (${zeroStock.length}): ${zeroStock.map(p => p.nombre).join(', ')}`);
  }

  // Low stock
  const lowStock = productos.filter(p => p.cantidad > 0 && p.cantidad < 20);
  if (lowStock.length) {
    sections.push(`STOCK BAJO (${lowStock.length}): ${lowStock.map(p => `${p.nombre}(${p.cantidad})`).join(', ')}`);
  }

  // Expiring lotes
  const weekFromNow = new Date(now.getTime() + 30 * DAY_MS);
  const expiring = lotes
    .filter(l => l.cantidad > 0 && l.vencimiento && l.vencimiento.toDate() <= weekFromNow)
    .map(l => {
      const days = Math.max(0, Math.ceil((l.vencimiento!.toDate().getTime() - now.getTime()) / DAY_MS));
      return `${l.productoNombre} lote ${l.numero}: ${l.cantidad}uds en ${days <= 0 ? 'VENCIDO' : days + 'd'}`;
    });
  if (expiring.length) {
    sections.push(`LOTES POR VENCER (30d): ${expiring.join(', ')}`);
  }

  // Top sales 30d
  const sales = new Map<string, { nombre: string; qty: number }>();
  for (const m of movimientos) {
    if (m.tipo !== 'salida' || m.motivo === 'anulacion' || m.fecha.toDate() < thirtyDaysAgo) continue;
    const entry = sales.get(m.productoId) || { nombre: m.productoNombre, qty: 0 };
    entry.qty += m.cantidad;
    sales.set(m.productoId, entry);
  }
  const topSales = [...sales.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
  if (topSales.length) {
    sections.push(`TOP VENTAS (30d): ${topSales.map(t => `${t.nombre}: ${t.qty} uds`).join(', ')}`);
  }

  // Stale products
  const activeIds = new Set<string>();
  for (const m of movimientos) {
    if (m.fecha.toDate() >= thirtyDaysAgo) activeIds.add(m.productoId);
  }
  const stale = productos.filter(p => p.cantidad > 0 && !activeIds.has(p.id));
  if (stale.length) {
    sections.push(`SIN MOVIMIENTO (30d): ${stale.map(p => p.nombre).join(', ')}`);
  }

  // Weekly trends
  const trends = computeWeeklyTrends(movimientos);
  if (trends.length >= 2) {
    const recent = trends[trends.length - 1];
    const prev = trends[trends.length - 2];
    sections.push(`TENDENCIA: semana actual ${recent.entradas} entradas/${recent.salidas} salidas, anterior ${prev.entradas}/${prev.salidas}`);
  }

  // Activity 7d
  sections.push(`ACTIVIDAD 7d: ${metrics.entradasUnits7d} uds entrada, ${metrics.salidasUnits7d} uds salida, ventas $${Math.round(metrics.ventasValue7d)}`);

  return sections.join('\n');
}

function gatherCrmContext(): string {
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * DAY_MS);
  const threeDays = new Date(now.getTime() + 3 * DAY_MS);
  const sections: string[] = [];

  // Cross-reference: expiring products + interested prospects
  const expiringProductNames = new Set<string>();
  for (const l of getLotes()) {
    if (l.cantidad > 0 && l.vencimiento && l.vencimiento.toDate() <= weekFromNow) {
      expiringProductNames.add(l.productoNombre.toLowerCase());
    }
  }

  const crossRef: string[] = [];
  const overdue: string[] = [];
  const upcoming: string[] = [];

  for (const p of getProspectos()) {
    if (p.resultado === 'cliente' || p.resultado === 'no_interesado') continue;

    if (p.fechaSeguimiento) {
      const sDate = p.fechaSeguimiento.toDate();
      if (isOverdue(p.fechaSeguimiento)) {
        const days = Math.ceil((now.getTime() - sDate.getTime()) / DAY_MS);
        overdue.push(`- ${p.local}: seguimiento vencido hace ${days}d, resultado=${p.resultado}`);
      } else if (sDate <= threeDays) {
        const days = Math.ceil((sDate.getTime() - now.getTime()) / DAY_MS);
        upcoming.push(`- ${p.local}: seguimiento en ${days === 0 ? 'HOY' : days + 'd'}, resultado=${p.resultado}`);
      }
    }

    if (p.productosInteres && expiringProductNames.size > 0) {
      const interests = p.productosInteres.toLowerCase();
      for (const name of expiringProductNames) {
        if (interests.includes(name)) {
          crossRef.push(`- ${p.local} interesado en ${name} (vence pronto). Contacto: ${p.contacto || 'sin contacto'}`);
          break;
        }
      }
    }
  }

  if (crossRef.length) sections.push(`OPORTUNIDADES:\n${crossRef.join('\n')}`);
  if (overdue.length) sections.push(`SEGUIMIENTOS VENCIDOS:\n${overdue.join('\n')}`);
  if (upcoming.length) sections.push(`SEGUIMIENTOS PROXIMOS:\n${upcoming.join('\n')}`);

  return sections.join('\n\n');
}

function buildDeltaContext(delta: SnapshotDelta): string {
  const lines: string[] = [];
  lines.push(`COMPARACION (hace ${delta.daysBetween}d):`);
  lines.push(`- Valor total: ${delta.totalValueChangePct >= 0 ? '+' : ''}${delta.totalValueChangePct}% ($${Math.round(delta.totalValueChange)})`);
  lines.push(`- Unidades: ${delta.totalUnitsChange >= 0 ? '+' : ''}${delta.totalUnitsChange}`);
  lines.push(`- Sin stock: ${delta.zeroStockChange >= 0 ? '+' : ''}${delta.zeroStockChange}`);
  lines.push(`- Lotes por vencer: ${delta.expiringChange >= 0 ? '+' : ''}${delta.expiringChange}`);
  if (delta.ventasValueChange !== 0) {
    lines.push(`- Ventas 7d: ${delta.ventasValueChange >= 0 ? '+' : ''}$${Math.round(delta.ventasValueChange)}`);
  }
  if (delta.productChanges.length > 0) {
    const improving = delta.productChanges.filter(c => c.status === 'improving');
    const worsening = delta.productChanges.filter(c => c.status === 'worsening');
    if (improving.length) lines.push(`- Mejoraron: ${improving.map(c => `${c.nombre} (+${c.cantidadChange})`).join(', ')}`);
    if (worsening.length) lines.push(`- Empeoraron: ${worsening.map(c => `${c.nombre} (${c.cantidadChange})`).join(', ')}`);
  }
  return lines.join('\n');
}

// ── Gemini Call ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Sos el analista de stock de Lahuen (cooperativa hidroponica argentina).
Genera un reporte diario para el equipo.

Reglas:
- Maximo 5 insights priorizando urgencia
- Maximo 3 sugerencias accionables para ventas
- Si hay datos de comparacion, agrega un comentario breve sobre la evolucion
- Cruza datos: stock por vencer + prospectos interesados, tendencias de venta
- Prioriza: riesgos de vencimiento, productos sin stock, oportunidades de venta
- Lenguaje argentino informal y directo
- Responde SOLO con JSON (sin markdown):
{"insights":[{"icon":"trend|rotation|alert|recommendation","title":"titulo","text":"detalle","severity":"info|warning|danger"}],"suggestions":[{"icon":"expiry|followup|lowstock|opportunity","text":"sugerencia"}],"deltaComment":"comentario evolucion o null"}

`;

interface GeminiResult {
  insights: StockInsight[];
  suggestions: Suggestion[];
  deltaComment: string | null;
}

async function callGemini(stockCtx: string, crmCtx: string, deltaCtx: string): Promise<GeminiResult> {
  let prompt = SYSTEM_PROMPT + 'DATOS ACTUALES:\n' + stockCtx;
  if (crmCtx) prompt += '\n\n' + crmCtx;
  if (deltaCtx) prompt += '\n\n' + deltaCtx;

  const result = await geminiModel.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
  });

  const text = result.response.text();

  // Try to parse as object first, then fall back to array
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      return {
        insights: Array.isArray(parsed.insights) ? parsed.insights : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        deltaComment: parsed.deltaComment || null,
      };
    } catch { /* fall through */ }
  }

  // Fallback: try to parse as array (old format)
  const arrMatch = text.match(/\[[\s\S]*?\]/);
  if (arrMatch) {
    const arr = JSON.parse(arrMatch[0]) as StockInsight[];
    return { insights: arr, suggestions: [], deltaComment: null };
  }

  throw new Error('No parseable JSON');
}

// ── Fallbacks ────────────────────────────────────────────────────────────

function buildFallbackInsights(stockCtx: string): StockInsight[] {
  const insights: StockInsight[] = [];
  if (stockCtx.includes('SIN STOCK')) {
    insights.push({ icon: 'alert', title: 'Productos sin stock', text: 'Hay productos agotados que necesitan reposicion.', severity: 'danger' });
  }
  if (stockCtx.includes('POR VENCER')) {
    insights.push({ icon: 'alert', title: 'Lotes por vencer', text: 'Hay lotes proximos a vencer. Considera liquidarlos o donarlos.', severity: 'warning' });
  }
  if (stockCtx.includes('STOCK BAJO')) {
    insights.push({ icon: 'recommendation', title: 'Stock bajo', text: 'Algunos productos tienen stock bajo. Planifica reposicion.', severity: 'warning' });
  }
  if (stockCtx.includes('SIN MOVIMIENTO')) {
    insights.push({ icon: 'rotation', title: 'Productos estancados', text: 'Hay productos con stock sin movimiento reciente.', severity: 'info' });
  }
  return insights;
}

function buildFallbackSuggestions(crmCtx: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  if (crmCtx.includes('OPORTUNIDADES')) suggestions.push({ icon: 'opportunity', text: 'Hay prospectos interesados en productos por vencer. Contactalos.' });
  if (crmCtx.includes('VENCIDOS')) suggestions.push({ icon: 'followup', text: 'Tenes seguimientos vencidos en el CRM.' });
  if (crmCtx.includes('PROXIMOS')) suggestions.push({ icon: 'followup', text: 'Tenes seguimientos para los proximos dias.' });
  return suggestions;
}

// ── Helpers ──────────────────────────────────────────────────────────────

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

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Firestore ────────────────────────────────────────────────────────────

async function saveToFirestore(report: StockReport): Promise<void> {
  const docRef = doc(db, COLLECTION, report.date);
  await setDoc(docRef, report, { merge: true });
}

async function loadPreviousReport(today: string): Promise<StockReport | null> {
  const q = query(
    collection(db, COLLECTION),
    orderBy('date', 'desc'),
    limit(2),
  );
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    const data = d.data() as StockReport;
    if (data.date !== today) return data;
  }
  return null;
}

// ── Local Cache ──────────────────────────────────────────────────────────

function loadLocalCache(): StockReport | null {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { report: StockReport; cachedAt: number };
    if (Date.now() - data.cachedAt > LOCAL_CACHE_TTL) return null;
    return data.report;
  } catch { return null; }
}

function saveLocalCache(report: StockReport) {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ report, cachedAt: Date.now() }));
  } catch { /* ignore */ }
}

function clearLocalCache() {
  try { localStorage.removeItem(LOCAL_CACHE_KEY); } catch { /* ignore */ }
}

function cleanOldCaches() {
  try {
    localStorage.removeItem('lahuen_stock_insights');
    localStorage.removeItem('lahuen_suggestions');
    // Clean per-product insight caches
    const keys = Object.keys(localStorage);
    for (const k of keys) {
      if (k.startsWith('lahuen_product_insight_')) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}
