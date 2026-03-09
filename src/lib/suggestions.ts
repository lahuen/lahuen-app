import { geminiModel } from './gemini';
import { isOverdue } from './format';
import { getProductos, getProspectos, getLotes } from './store';
import type { Prospecto, Producto, Lote } from './types';

export interface Suggestion {
  icon: 'expiry' | 'followup' | 'lowstock' | 'opportunity';
  text: string;
}

interface SuggestionsCache {
  suggestions: Suggestion[];
  timestamp: number;
  dataHash: string;
}

const CACHE_KEY = 'lahuen_suggestions';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// ── Public API ────────────────────────────────────────────────────────────

export async function getSuggestions(): Promise<Suggestion[]> {
  const context = gatherContext();

  if (!context.hasEvents) return [];

  const hash = context.dataHash;
  const cached = loadCache();
  if (cached && cached.dataHash === hash && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.suggestions;
  }

  const suggestions = await callGemini(context.prompt);
  saveCache({ suggestions, timestamp: Date.now(), dataHash: hash });
  return suggestions;
}

// ── Data Gathering ────────────────────────────────────────────────────────

interface ContextResult {
  hasEvents: boolean;
  dataHash: string;
  prompt: string;
}

function gatherContext(): ContextResult {
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 86400000);
  const threeDays = new Date(now.getTime() + 3 * 86400000);

  const productos = getProductos();
  const priceMap = new Map<string, number>();
  for (const p of productos) priceMap.set(p.id, p.precio);

  // Stock alerts
  const expiring: string[] = [];
  const lowStock: string[] = [];
  const outOfStock: string[] = [];
  let riskValue = 0;

  // Check expiring from lotes (cantidad > 0)
  for (const l of getLotes()) {
    if (l.cantidad > 0 && l.vencimiento) {
      const vDate = l.vencimiento.toDate();
      if (vDate <= weekFromNow) {
        const days = Math.ceil((vDate.getTime() - now.getTime()) / 86400000);
        const price = priceMap.get(l.productoId) || 0;
        riskValue += l.cantidad * price;
        expiring.push(`- ${l.productoNombre} (lote ${l.numero}): ${l.cantidad} uds, vence en ${days <= 0 ? 'VENCIDO' : days + ' dias'}, valor $${Math.round(l.cantidad * price)}`);
      }
    }
  }

  for (const p of productos) {
    if (p.cantidad === 0) {
      outOfStock.push(`- ${p.nombre}: sin stock`);
    } else if (p.cantidad > 0 && p.cantidad < 20) {
      lowStock.push(`- ${p.nombre}: ${p.cantidad} ${p.unidad} (stock bajo)`);
    }
  }

  // CRM alerts
  const overdue: string[] = [];
  const upcoming: string[] = [];

  // Cross-reference: prospects interested in expiring products
  const crossRef: string[] = [];
  const expiringProductNames = new Set<string>();
  for (const l of getLotes()) {
    if (l.cantidad > 0 && l.vencimiento && l.vencimiento.toDate() <= weekFromNow) {
      expiringProductNames.add(l.productoNombre.toLowerCase());
    }
  }

  for (const p of getProspectos()) {
    if (p.resultado === 'cliente' || p.resultado === 'no_interesado') continue;

    if (p.fechaSeguimiento) {
      const sDate = p.fechaSeguimiento.toDate();
      if (isOverdue(p.fechaSeguimiento)) {
        const days = Math.ceil((now.getTime() - sDate.getTime()) / 86400000);
        overdue.push(`- ${p.local}: seguimiento vencido hace ${days}d, resultado=${p.resultado}${p.productosInteres ? ', interes=' + p.productosInteres : ''}`);
      } else if (sDate <= threeDays) {
        const days = Math.ceil((sDate.getTime() - now.getTime()) / 86400000);
        upcoming.push(`- ${p.local}: seguimiento en ${days === 0 ? 'HOY' : days + 'd'}, resultado=${p.resultado}${p.productosInteres ? ', interes=' + p.productosInteres : ''}`);
      }
    }

    // Cross-reference: prospect interested in product that's expiring
    if (p.productosInteres && expiringProductNames.size > 0) {
      const interests = p.productosInteres.toLowerCase();
      for (const name of expiringProductNames) {
        if (interests.includes(name)) {
          crossRef.push(`- ${p.local} esta interesado en ${name} (que vence pronto). Contacto: ${p.contacto || 'sin contacto'}`);
          break;
        }
      }
    }
  }

  const hasEvents = expiring.length + lowStock.length + outOfStock.length + overdue.length + upcoming.length + crossRef.length > 0;
  const dataHash = `${expiring.length}-${lowStock.length}-${outOfStock.length}-${overdue.length}-${upcoming.length}-${crossRef.length}-${Math.round(riskValue)}`;

  let prompt = '';
  if (riskValue > 0) prompt += `VALOR EN RIESGO (stock por vencer): $${Math.round(riskValue)}\n\n`;
  if (expiring.length) prompt += `STOCK POR VENCER:\n${expiring.join('\n')}\n\n`;
  if (crossRef.length) prompt += `OPORTUNIDADES (prospectos interesados en productos por vencer):\n${crossRef.join('\n')}\n\n`;
  if (outOfStock.length) prompt += `SIN STOCK:\n${outOfStock.join('\n')}\n\n`;
  if (lowStock.length) prompt += `STOCK BAJO:\n${lowStock.join('\n')}\n\n`;
  if (overdue.length) prompt += `SEGUIMIENTOS VENCIDOS:\n${overdue.join('\n')}\n\n`;
  if (upcoming.length) prompt += `SEGUIMIENTOS PROXIMOS:\n${upcoming.join('\n')}\n\n`;

  return { hasEvents, dataHash, prompt };
}

// ── Gemini Call ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Sos un asistente de la cooperativa hidroponica Lahuen.
Analiza las alertas actuales y genera sugerencias accionables para el equipo de ventas.

Reglas:
- Maximo 4 sugerencias, priorizando urgencia
- Cada sugerencia breve (1-2 oraciones)
- Cruza datos cuando sea posible (ej: stock que vence + prospectos que compran ese producto)
- Usa lenguaje directo y argentino informal
- Si hay stock por vencer sugeri a quien contactar para venderlo
- Responde SOLO con JSON array:
[{"icon":"expiry|followup|lowstock|opportunity","text":"sugerencia"}]

DATOS ACTUALES:
`;

async function callGemini(contextPrompt: string): Promise<Suggestion[]> {
  try {
    const result = await geminiModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: SYSTEM_PROMPT + contextPrompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 500 },
    });
    const text = result.response.text();
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as Suggestion[];
  } catch {
    // Fail silently — suggestions are non-critical
    return buildFallbackSuggestions(contextPrompt);
  }
}

function buildFallbackSuggestions(prompt: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  if (prompt.includes('POR VENCER')) suggestions.push({ icon: 'expiry', text: 'Hay productos por vencer. Revisa el stock.' });
  if (prompt.includes('SIN STOCK')) suggestions.push({ icon: 'lowstock', text: 'Hay productos sin stock.' });
  if (prompt.includes('VENCIDOS')) suggestions.push({ icon: 'followup', text: 'Tenes seguimientos vencidos en el CRM.' });
  if (prompt.includes('PROXIMOS')) suggestions.push({ icon: 'followup', text: 'Tenes seguimientos para los proximos dias.' });
  return suggestions;
}

// ── Cache ─────────────────────────────────────────────────────────────────

function loadCache(): SuggestionsCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveCache(data: SuggestionsCache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}
