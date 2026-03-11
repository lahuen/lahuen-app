import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';
import { app } from './firebase';
import { getProductos, getLotes, getMovimientos } from './store';
import { computeFunnel } from './funnel';

const ai = getAI(app, { backend: new GoogleAIBackend() });
const model = getGenerativeModel(ai, { model: 'gemini-2.5-flash' });
export { model as geminiModel };

export type SmartAction =
  | { action: 'stock_entrada'; producto: string; cantidad: number; unidad: string; motivo: string }
  | { action: 'stock_salida'; producto: string; cantidad: number; unidad: string; motivo: string }
  | { action: 'venta'; producto: string; cantidad: number; unidad: string; prospecto: string; precio: number | null }
  | { action: 'nuevo_prospecto'; local: string; contacto: string; whatsapp: string; perfil: string; zona: string }
  | { action: 'consulta'; query: string }
  | { action: 'error'; message: string };

function buildSystemPrompt(): string {
  const productNames = getProductos().map(p => p.nombre.toLowerCase());
  const productList = productNames.length > 0 ? productNames.join(', ') : 'lechuga crespa, lechuga mantecosa, rucula, albahaca, ciboulette, perejil, menta, berro';

  return `Sos un asistente de una cooperativa hidroponera argentina llamada Lahuen.
Parsea la entrada del usuario y determina que accion quiere hacer.

Hay 5 acciones posibles:
1. "stock_entrada" - Agregar stock (cosecha o compra). Ejemplo: "cosechamos 200 bandejas de lechuga crespa"
2. "stock_salida" - Registrar salida/merma/descarte. Ejemplo: "tiramos 10 lechugas", "merma 5 albahaca", "descartamos 20 rucula"
3. "venta" - Registrar una venta (descuenta stock). Ejemplo: "se vendieron 50 atados de rucula a Restaurant El Roble"
4. "nuevo_prospecto" - Agregar prospecto al CRM. Ejemplo: "agregar prospecto Bar La Luna zona Moreno contacto Juan 1155667788"
5. "consulta" - Consulta sobre stock, vencimientos, productos. Ejemplo: "cuanto stock tengo de lechuga?", "que vence esta semana?"

Productos conocidos: ${productList}.
Unidades comunes: bandejas, atados, kg, unidades.
Perfiles: restaurante, hotel, bar, dietetica, revendedor, mercado, distribuidor, feria, supermercado, comunidad, otro.

Responde SOLO con JSON, sin explicaciones:

Para stock_entrada:
{"action":"stock_entrada","producto":"string","cantidad":number,"unidad":"string","motivo":"cosecha|compra|devolucion"}

Para stock_salida:
{"action":"stock_salida","producto":"string","cantidad":number,"unidad":"string","motivo":"merma|descarte|ajuste"}

Para venta:
{"action":"venta","producto":"string","cantidad":number,"unidad":"string","prospecto":"string","precio":null}

Para nuevo_prospecto:
{"action":"nuevo_prospecto","local":"string","contacto":"string","whatsapp":"string","perfil":"string","zona":"string"}

Para consulta:
{"action":"consulta","query":"la consulta del usuario"}

Si no podes determinar la accion o faltan datos criticos:
{"action":"error","message":"descripcion del problema"}`;
}

// Rate limiting: min 3s between calls, max 30 calls per day
let lastCallTime = 0;
const DAILY_KEY = 'lahuen_gemini_count';
const MAX_DAILY = 30;
const MIN_INTERVAL = 3000;

export function checkRateLimit(): boolean {
  const now = Date.now();
  if (now - lastCallTime < MIN_INTERVAL) return false;

  const stored = localStorage.getItem(DAILY_KEY);
  const data = stored ? JSON.parse(stored) : { date: '', count: 0 };
  const today = new Date().toISOString().slice(0, 10);
  if (data.date !== today) { data.date = today; data.count = 0; }
  if (data.count >= MAX_DAILY) return false;

  data.count++;
  localStorage.setItem(DAILY_KEY, JSON.stringify(data));
  lastCallTime = now;
  return true;
}

export async function parseSmartInput(input: string): Promise<SmartAction> {
  if (!checkRateLimit()) {
    return localParse(input);
  }

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `${buildSystemPrompt()}\n\nEntrada: "${input}"` }] }],
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
const SALIDA_KEYWORDS = ['tiramos', 'tiraron', 'merma', 'descartamos', 'descarte', 'perdimos', 'se pudrio', 'pudrieron', 'basura'];
const VENTA_KEYWORDS = ['vendi', 'vendio', 'vendimos', 'venta', 'entrego', 'llevo', 'despacho', 'vendieron'];
const PROSPECTO_KEYWORDS = ['prospecto', 'nuevo prospecto', 'agregar prospecto', 'nuevo cliente', 'agregar cliente'];
const CONSULTA_KEYWORDS = ['cuanto', 'cuantos', 'cuantas', 'que vence', 'que tengo', 'hay stock', 'stock de', 'tenemos de', 'queda de', 'cuanto hay'];

function buildProductMap(): Record<string, string> {
  const productos = getProductos();
  const map: Record<string, string> = {};
  for (const p of productos) {
    const lower = p.nombre.toLowerCase();
    map[lower] = p.nombre;
    // Also add individual words for partial matching (e.g., "lechuga" -> "Lechuga Crespa")
    const words = lower.split(/\s+/);
    if (words.length > 1) {
      for (const w of words) {
        if (w.length > 3 && !map[w]) map[w] = p.nombre;
      }
    }
  }
  // Fallback for empty store
  if (Object.keys(map).length === 0) {
    Object.assign(map, {
      lechuga: 'Lechuga Crespa', 'lechuga crespa': 'Lechuga Crespa',
      'lechuga mantecosa': 'Lechuga Mantecosa', mantecosa: 'Lechuga Mantecosa',
      rucula: 'Rucula', albahaca: 'Albahaca',
      ciboulette: 'Ciboulette', perejil: 'Perejil',
      menta: 'Menta', berro: 'Berro',
    });
  }
  return map;
}

const UNIT_MAP: Record<string, string> = {
  bandeja: 'bandejas', bandejas: 'bandejas',
  atado: 'atados', atados: 'atados',
  kg: 'kg', kilo: 'kg', kilos: 'kg',
  unidad: 'unidades', unidades: 'unidades',
};

function localParse(input: string): SmartAction {
  const lower = input.toLowerCase().trim();

  // Detect action type
  let actionType: 'stock_entrada' | 'stock_salida' | 'venta' | 'nuevo_prospecto' | 'consulta' | null = null;
  if (CONSULTA_KEYWORDS.some(k => lower.includes(k))) actionType = 'consulta';
  else if (PROSPECTO_KEYWORDS.some(k => lower.includes(k))) actionType = 'nuevo_prospecto';
  else if (SALIDA_KEYWORDS.some(k => lower.includes(k))) actionType = 'stock_salida';
  else if (VENTA_KEYWORDS.some(k => lower.includes(k))) actionType = 'venta';
  else if (ENTRADA_KEYWORDS.some(k => lower.includes(k))) actionType = 'stock_entrada';

  if (!actionType) {
    return { action: 'error', message: 'No pude entender la accion. Proba con "stock", "venta", "merma", "cuanto..." o "prospecto".' };
  }

  if (actionType === 'consulta') {
    return { action: 'consulta', query: input.trim() };
  }

  // Extract quantity
  const qtyMatch = lower.match(/(\d+)/);
  const cantidad = qtyMatch ? parseInt(qtyMatch[1], 10) : 0;

  // Extract product (dynamic from store)
  const productMap = buildProductMap();
  let producto = '';
  // Try longer keys first for better matching
  const sortedKeys = Object.keys(productMap).sort((a, b) => b.length - a.length);
  for (const keyword of sortedKeys) {
    if (lower.includes(keyword)) { producto = productMap[keyword]; break; }
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

  if (actionType === 'stock_salida') {
    if (!producto) return { action: 'error', message: 'No detecte el producto. Menciona: lechuga, rucula, albahaca, etc.' };
    if (!cantidad) return { action: 'error', message: 'No detecte la cantidad.' };
    const motivo = lower.includes('descarte') || lower.includes('basura') ? 'descarte' : lower.includes('ajuste') ? 'ajuste' : 'merma';
    return { action: 'stock_salida', producto, cantidad, unidad, motivo };
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

// ── Contextual Assistant ──────────────────────────────────────────────────

function buildAssistantContext(): string {
  const productos = getProductos();
  const lotes = getLotes();
  const movimientos = getMovimientos();
  const funnel = computeFunnel('30d');
  const now = Date.now();
  const weekFromNow = now + 7 * 86400000;

  const sections: string[] = [];

  // Stock summary
  const total = productos.reduce((s, p) => s + p.cantidad, 0);
  const value = productos.reduce((s, p) => s + p.cantidad * p.precio, 0);
  sections.push(`STOCK: ${productos.length} productos, ${total} unidades, valor $${Math.round(value)}`);

  const zero = productos.filter(p => p.cantidad === 0);
  if (zero.length) sections.push(`SIN STOCK: ${zero.map(p => p.nombre).join(', ')}`);

  const low = productos.filter(p => p.cantidad > 0 && p.cantidad < 20);
  if (low.length) sections.push(`STOCK BAJO: ${low.map(p => `${p.nombre}(${p.cantidad})`).join(', ')}`);

  // Expiring
  const expiring = lotes.filter(l =>
    l.cantidad > 0 && l.vencimiento && l.vencimiento.toDate().getTime() <= weekFromNow && l.vencimiento.toDate().getTime() > now
  );
  if (expiring.length) {
    sections.push(`POR VENCER (7d): ${expiring.map(l => {
      const days = Math.ceil((l.vencimiento!.toDate().getTime() - now) / 86400000);
      return `${l.productoNombre} lote ${l.numero} en ${days}d`;
    }).join(', ')}`);
  }

  // Funnel
  sections.push(`FUNNEL 30d: Produccion ${funnel.produccion}, Compras ${funnel.compras}, Ventas ${funnel.ventas} (${funnel.ventaPct}%), Merma ${funnel.merma} (${funnel.perdidaPct}%), Revenue $${Math.round(funnel.ventasRevenue)}`);
  if (funnel.topLoss.length) {
    sections.push(`MAYOR PERDIDA: ${funnel.topLoss.map(p => `${p.nombre} ${p.pct}%`).join(', ')}`);
  }

  // Recent movements (last 5)
  const recent = movimientos.filter(m => m.motivo !== 'anulacion').slice(0, 5);
  if (recent.length) {
    sections.push(`ULTIMOS MOVIMIENTOS: ${recent.map(m => `${m.tipo} ${m.cantidad} ${m.productoNombre} (${m.motivo})`).join('; ')}`);
  }

  // App guide
  sections.push(`GUIA DE USO:
- Stock: ver productos, KPIs, treemap. Boton "+ Producto" para crear.
- Movimientos: historial de entradas/salidas, buscar, anular operaciones.
- Lotes: seguimiento de lotes por producto con vencimiento y ubicacion.
- CRM: prospectos comerciales, seguimiento, estado (frio/templado/caliente/cerrado/perdido).
- Agenda: timeline de seguimientos y visitas pendientes.
- Asistente: registrar movimientos en lenguaje natural (ej: "cosechamos 200 lechuga", "venta 50 rucula a El Roble").
- Para registrar una entrada: decir "cosechamos X de [producto]" o "entraron X [producto]".
- Para registrar una venta: decir "vendimos X [producto] a [cliente]".
- Para registrar merma: decir "tiramos X [producto]" o "merma X [producto]".
- Para crear prospecto: decir "nuevo prospecto [nombre] contacto [persona] zona [zona]".`);

  return sections.join('\n');
}

export async function askAssistant(question: string): Promise<string> {
  if (!checkRateLimit()) {
    return 'Limite de consultas alcanzado. Intenta mas tarde.';
  }

  const context = buildAssistantContext();
  const systemPrompt = `Sos el asistente de Lahuen CRM, una cooperativa hidroponera argentina.
Responde preguntas sobre stock, operaciones, como usar la app, y analisis del negocio.
Usa los datos provistos abajo. Responde breve, en argentino, maximo 3-4 oraciones.
Si te preguntan algo que no sabes, decilo.

DATOS ACTUALES:
${context}`;

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nPregunta: "${question}"` }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 400 },
    });
    return result.response.text().trim();
  } catch {
    return 'Error al consultar. Intenta de nuevo.';
  }
}
