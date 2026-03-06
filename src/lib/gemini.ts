import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';
import { app } from './firebase';

const ai = getAI(app, { backend: new GoogleAIBackend() });
const model = getGenerativeModel(ai, { model: 'gemini-2.5-flash' });

export type SmartAction =
  | { action: 'stock_entrada'; producto: string; cantidad: number; unidad: string; motivo: string }
  | { action: 'venta'; producto: string; cantidad: number; unidad: string; prospecto: string; precio: number | null }
  | { action: 'nuevo_prospecto'; local: string; contacto: string; whatsapp: string; perfil: string; zona: string }
  | { action: 'error'; message: string };

const SYSTEM_PROMPT = `Sos un asistente de una cooperativa hidroponera argentina llamada Lahuen.
Parsea la entrada del usuario y determina que accion quiere hacer.

Hay 3 acciones posibles:
1. "stock_entrada" - Agregar stock (cosecha o compra). Ejemplo: "cosechamos 200 bandejas de lechuga crespa"
2. "venta" - Registrar una venta (descuenta stock). Ejemplo: "se vendieron 50 atados de rucula a Restaurant El Roble"
3. "nuevo_prospecto" - Agregar prospecto al CRM. Ejemplo: "agregar prospecto Bar La Luna zona Moreno contacto Juan 1155667788"

Productos conocidos: lechuga crespa, lechuga mantecosa, rucula, albahaca, ciboulette, perejil, menta, berro.
Unidades comunes: bandejas, atados, kg, unidades.
Perfiles: restaurante, hotel, bar, dietetica, revendedor, mercado, distribuidor, feria, supermercado, comunidad, otro.

Responde SOLO con JSON, sin explicaciones:

Para stock_entrada:
{"action":"stock_entrada","producto":"string","cantidad":number,"unidad":"string","motivo":"cosecha|compra|devolucion"}

Para venta:
{"action":"venta","producto":"string","cantidad":number,"unidad":"string","prospecto":"string","precio":null}

Para nuevo_prospecto:
{"action":"nuevo_prospecto","local":"string","contacto":"string","whatsapp":"string","perfil":"string","zona":"string"}

Si no podes determinar la accion o faltan datos criticos:
{"action":"error","message":"descripcion del problema"}`;

export async function parseSmartInput(input: string): Promise<SmartAction> {
  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `${SYSTEM_PROMPT}\n\nEntrada: "${input}"` }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
    });

    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error('No JSON');

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.action && parsed.action !== 'error') return parsed as SmartAction;
    if (parsed.action === 'error') return parsed as SmartAction;
    throw new Error('Invalid action');
  } catch {
    return localParse(input);
  }
}

// ── Local Fallback Parser ──────────────────────────────────────────────────

const ENTRADA_KEYWORDS = ['stock', 'cosecha', 'cosechamos', 'entraron', 'llegaron', 'nuevo stock', 'ingreso'];
const VENTA_KEYWORDS = ['vendi', 'vendio', 'vendimos', 'venta', 'entrego', 'llevo', 'despacho', 'vendieron'];
const PROSPECTO_KEYWORDS = ['prospecto', 'nuevo prospecto', 'agregar prospecto', 'nuevo cliente', 'agregar cliente'];

const PRODUCT_MAP: Record<string, string> = {
  lechuga: 'Lechuga Crespa', 'lechuga crespa': 'Lechuga Crespa',
  'lechuga mantecosa': 'Lechuga Mantecosa', mantecosa: 'Lechuga Mantecosa',
  rucula: 'Rucula', albahaca: 'Albahaca',
  ciboulette: 'Ciboulette', perejil: 'Perejil',
  menta: 'Menta', berro: 'Berro',
};

const UNIT_MAP: Record<string, string> = {
  bandeja: 'bandejas', bandejas: 'bandejas',
  atado: 'atados', atados: 'atados',
  kg: 'kg', kilo: 'kg', kilos: 'kg',
  unidad: 'unidades', unidades: 'unidades',
};

function localParse(input: string): SmartAction {
  const lower = input.toLowerCase().trim();

  // Detect action type
  let actionType: 'stock_entrada' | 'venta' | 'nuevo_prospecto' | null = null;
  if (PROSPECTO_KEYWORDS.some(k => lower.includes(k))) actionType = 'nuevo_prospecto';
  else if (VENTA_KEYWORDS.some(k => lower.includes(k))) actionType = 'venta';
  else if (ENTRADA_KEYWORDS.some(k => lower.includes(k))) actionType = 'stock_entrada';

  if (!actionType) {
    return { action: 'error', message: 'No pude entender la accion. Proba con "stock", "venta" o "prospecto".' };
  }

  // Extract quantity
  const qtyMatch = lower.match(/(\d+)/);
  const cantidad = qtyMatch ? parseInt(qtyMatch[1], 10) : 0;

  // Extract product
  let producto = '';
  for (const [keyword, name] of Object.entries(PRODUCT_MAP)) {
    if (lower.includes(keyword)) { producto = name; break; }
  }

  // Extract unit
  let unidad = 'unidades';
  for (const [keyword, unit] of Object.entries(UNIT_MAP)) {
    if (lower.includes(keyword)) { unidad = unit; break; }
  }

  if (actionType === 'stock_entrada') {
    if (!producto) return { action: 'error', message: 'No detecte el producto. Menciona: lechuga, rucula, albahaca, etc.' };
    if (!cantidad) return { action: 'error', message: 'No detecte la cantidad.' };
    const motivo = lower.includes('compra') ? 'compra' : lower.includes('devolucion') ? 'devolucion' : 'cosecha';
    return { action: 'stock_entrada', producto, cantidad, unidad, motivo };
  }

  if (actionType === 'venta') {
    if (!producto) return { action: 'error', message: 'No detecte el producto.' };
    if (!cantidad) return { action: 'error', message: 'No detecte la cantidad.' };

    // Extract prospect name: text after "a " preposition
    let prospecto = '';
    const aMatch = lower.match(/\ba\s+([a-záéíóúñ\s]+?)(?:\s+\d|\s*$)/i);
    if (aMatch) prospecto = aMatch[1].trim();

    return { action: 'venta', producto, cantidad, unidad, prospecto, precio: null };
  }

  // nuevo_prospecto — extract what we can
  return {
    action: 'nuevo_prospecto',
    local: extractAfter(lower, 'prospecto') || extractAfter(lower, 'cliente') || '',
    contacto: extractAfter(lower, 'contacto') || '',
    whatsapp: (lower.match(/\d{10,13}/) || [''])[0],
    perfil: detectPerfil(lower),
    zona: extractAfter(lower, 'zona') || '',
  };
}

function extractAfter(text: string, keyword: string): string {
  const idx = text.indexOf(keyword);
  if (idx === -1) return '';
  const after = text.slice(idx + keyword.length).trim();
  // Take words until next keyword or end
  const nextKeyword = after.match(/\b(contacto|zona|perfil|whatsapp|telefono)\b/);
  return nextKeyword ? after.slice(0, nextKeyword.index).trim() : after.trim();
}

function detectPerfil(text: string): string {
  const perfiles = ['restaurante', 'hotel', 'bar', 'dietetica', 'revendedor', 'mercado', 'distribuidor', 'feria', 'supermercado', 'comunidad'];
  for (const p of perfiles) {
    if (text.includes(p)) return p;
  }
  return 'otro';
}
