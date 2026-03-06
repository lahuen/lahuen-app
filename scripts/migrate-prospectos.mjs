/**
 * One-time migration: import 35 prospectos from the old CRM Sheet into Firestore.
 *
 * Usage:
 *   export GOOGLE_APPLICATION_CREDENTIALS=path/to/serviceAccountKey.json
 *   node scripts/migrate-prospectos.mjs
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(
  readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'),
);

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

function parseDate(str) {
  if (!str) return null;
  // Handles "02/03/2026" (dd/mm/yyyy) and "2/03/2026 18:31:21"
  const parts = str.trim().split(/[\s]+/)[0].split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  return Timestamp.fromDate(new Date(y, m - 1, d));
}

const prospectos = [
  { fecha: '02/03/2026', local: 'Sheraton Pilar', contacto: '', whatsapp: '2304385000', perfil: 'hotel', zona: 'Pilar', segmento: 'premium', direccion: 'Panamericana Km 49.5', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Alta gastronomía y hotelería de lujo. Preguntar por Chef Ejecutivo o Encargado de Compras.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Hilton Pilar', contacto: '', whatsapp: '2304533800', perfil: 'hotel', zona: 'Pilar', segmento: 'premium', direccion: 'Ruta 8 Km 60.5', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Alta gastronomía y hotelería de lujo. Preguntar por Chef Ejecutivo o Encargado de Compras.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Kos Pilar Hotel', contacto: '', whatsapp: '1121526500', perfil: 'hotel', zona: 'Pilar', segmento: 'premium', direccion: '', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Hotelería premium. Preguntar por Chef Ejecutivo o Encargado de Compras.', vendedor: '' },
  { fecha: '02/03/2026', local: 'ibis Pilar', contacto: '', whatsapp: '2304386666', perfil: 'hotel', zona: 'Pilar', segmento: 'premium', direccion: '', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Hotelería. Volumen medio.', vendedor: '' },
  { fecha: '02/03/2026', local: 'La Posta del Pilar', contacto: '', whatsapp: '2304490890', perfil: 'hotel', zona: 'Pilar', segmento: 'premium', direccion: '', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Hotelería premium.', vendedor: '' },
  { fecha: '02/03/2026', local: 'PH PRO Hotel', contacto: '', whatsapp: '2304480713', perfil: 'hotel', zona: 'Pilar', segmento: 'premium', direccion: '', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Hotelería.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Brisas del Campo', contacto: '', whatsapp: '1164324072', perfil: 'hotel', zona: 'Pilar', segmento: 'premium', direccion: '', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Hotelería zona Pilar/Villa Rosa.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Trufa Pilar', contacto: '', whatsapp: '+5491157007663', perfil: 'restaurante', zona: 'Pilar', segmento: 'premium', direccion: 'Calle R. Caamaño 1370', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Restaurante premium en Pilar.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Sudeste Restó', contacto: '', whatsapp: '', perfil: 'restaurante', zona: 'Pilar', segmento: 'premium', direccion: 'Complejo Pilar Walk', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Falta contacto. Visitar presencial.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Hierro Parrilla', contacto: '', whatsapp: '+541128756355', perfil: 'restaurante', zona: 'CABA - Palermo Soho', segmento: 'premium', direccion: 'Costa Rica 5602', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Parrilla de autor. Ideal rúcula y hojas para guarnición.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Calden del Soho', contacto: '', whatsapp: '+541130312221', perfil: 'restaurante', zona: 'CABA - Palermo Soho', segmento: 'premium', direccion: 'Honduras 4701', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Parrilla de autor.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Minga Parrilla', contacto: '', whatsapp: '+541180310574', perfil: 'restaurante', zona: 'CABA - Palermo Soho', segmento: 'premium', direccion: 'Costa Rica 4528', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Parrilla de autor.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Puerto Cristal', contacto: '', whatsapp: '+541143313309', perfil: 'restaurante', zona: 'CABA - Puerto Madero', segmento: 'premium', direccion: 'Av. Alicia M. de Justo 1082', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Restaurante premium Puerto Madero.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Happening', contacto: '', whatsapp: '+541150319871', perfil: 'restaurante', zona: 'CABA - Puerto Madero', segmento: 'premium', direccion: 'Av. Alicia M. de Justo 310', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Restaurante premium Puerto Madero.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Patio Madero', contacto: '', whatsapp: '+5491150379581', perfil: 'restaurante', zona: 'CABA - Puerto Madero', segmento: 'premium', direccion: 'Olga Cossettini 1611', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Restaurante premium Puerto Madero.', vendedor: '' },
  { fecha: '02/03/2026', local: 'La Esquina de Bella Vista', contacto: '', whatsapp: '+541176335966', perfil: 'restaurante', zona: 'Bella Vista', segmento: 'medio', direccion: '', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: 'rúcula, albahaca', notas: '', vendedor: '' },
  { fecha: '02/03/2026', local: 'Varvarco San Miguel', contacto: '', whatsapp: '+541146678013', perfil: 'restaurante', zona: 'San Miguel', segmento: 'medio', direccion: '', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: 'rúcula, albahaca', notas: '', vendedor: '' },
  { fecha: '02/03/2026', local: 'CERES Resto Bar', contacto: '', whatsapp: '+541146668226', perfil: 'restaurante', zona: 'San Miguel', segmento: 'medio', direccion: '', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: 'rúcula, albahaca', notas: '', vendedor: '' },
  { fecha: '02/03/2026', local: 'El Tero Frutihortícola', contacto: '', whatsapp: '+541120007946', perfil: 'distribuidor', zona: 'Pilar', segmento: 'volumen', direccion: 'Colectora Ruta 8 Km 57.5', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Frutihortícola. Potencial volumen.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Mercado de Pilar', contacto: '', whatsapp: '+541153456137', perfil: 'mercado', zona: 'Pilar', segmento: 'volumen', direccion: 'Av. Dardo Rocha 80', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Mercado. Rotación rápida.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Despensa Don Carlos', contacto: '', whatsapp: '+542304457109', perfil: 'revendedor', zona: 'Pilar', segmento: 'volumen', direccion: '', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Despensa zona Pilar.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Mercado Concentrador de Moreno', contacto: '', whatsapp: '', perfil: 'mercado', zona: 'Moreno', segmento: 'volumen', direccion: 'Ruta 23 y Graham Bell', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Mayorista. Ir presencial de madrugada. Falta contacto.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Cooperativa El Progreso', contacto: '', whatsapp: '', perfil: 'mercado', zona: 'Moreno Centro', segmento: 'volumen', direccion: 'Av. Victorica', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Mercado regional. Consultar en administración. Falta contacto.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Ferias Minoristas de Moreno', contacto: '', whatsapp: '', perfil: 'feria', zona: 'Moreno', segmento: 'volumen', direccion: 'Playón Municipal / Estación', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Puestos fijos. Contacto directo con puesteros.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Supermercados Chinos (Red Local)', contacto: '', whatsapp: '', perfil: 'revendedor', zona: 'Francisco Álvarez / La Reja', segmento: 'volumen', direccion: '', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Cadena local. Visita directa al encargado de frescos.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Mercado Concentrador José C. Paz', contacto: '', whatsapp: '', perfil: 'mercado', zona: 'José C. Paz', segmento: 'volumen', direccion: 'Av. Hipólito Yrigoyen (Ruta 197)', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Mayorista. Rotación masiva. Cercano a Cuartel V.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Mercado San Miguel', contacto: '', whatsapp: '', perfil: 'mercado', zona: 'San Miguel', segmento: 'volumen', direccion: 'Av. Dr. Ricardo Balbín', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Mayorista/Minorista.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Mercado Regional de Luján', contacto: '', whatsapp: '', perfil: 'mercado', zona: 'Luján', segmento: 'volumen', direccion: 'Acceso Oeste Km 66', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Gran afluencia de verduleros de zona.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Mercado de Tres de Febrero', contacto: '', whatsapp: '', perfil: 'mercado', zona: 'Caseros', segmento: 'volumen', direccion: 'Av. Marcelo T. de Alvear', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Volumen masivo GBA.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Nodos de Consumo Responsable', contacto: '', whatsapp: '', perfil: 'comunidad', zona: 'San Miguel / Moreno', segmento: 'volumen', direccion: '', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Compras comunitarias. Buscan precio/calidad.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Carrefour (Corporativo)', contacto: '', whatsapp: '1121745328', perfil: 'supermercado', zona: 'Martínez', segmento: 'corporativo', direccion: 'Cuyo 3367 Martínez', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Email: cristian_genta@carrefour.com.ar. Portal de Proveedores Online. Proceso largo.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Cencosud (Jumbo/Disco/Vea)', contacto: '', whatsapp: '+541147331000', perfil: 'supermercado', zona: 'Martínez', segmento: 'corporativo', direccion: 'Paraná 3745 Martínez', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Portal Nuevos Negocios. Proceso largo.', vendedor: '' },
  { fecha: '02/03/2026', local: 'ChangoMás', contacto: '', whatsapp: '8104449256', perfil: 'supermercado', zona: '', segmento: 'corporativo', direccion: '', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Programa de Productores Locales activo. WhatsApp ToMâs: 11-2722-8644.', vendedor: '' },
  { fecha: '02/03/2026', local: 'Coto', contacto: '', whatsapp: '8008884848', perfil: 'supermercado', zona: '', segmento: 'corporativo', direccion: '', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: 'Email: info@coto.com.ar. Proceso largo.', vendedor: '' },
  { fecha: '02/03/2026', local: 'The Garden Brunch', contacto: 'N/A', whatsapp: '1121598283', perfil: 'restaurante', zona: 'Moreno Centro', segmento: 'medio', direccion: 'Aristóbulo del Valle 2628', resultado: 'pendiente', fechaVisita: '', fechaSeguimiento: '', productosInteres: '', notas: '', vendedor: 'cbd.preparados@gmail.com' },
];

async function migrate() {
  const batch = db.batch();
  const col = db.collection('prospectos');

  for (const p of prospectos) {
    const ref = col.doc();
    batch.set(ref, {
      local: p.local,
      contacto: p.contacto === 'N/A' ? '' : p.contacto,
      whatsapp: p.whatsapp,
      perfil: p.perfil,
      zona: p.zona,
      segmento: p.segmento,
      direccion: p.direccion,
      resultado: p.resultado,
      fechaVisita: parseDate(p.fechaVisita),
      fechaSeguimiento: parseDate(p.fechaSeguimiento),
      productosInteres: p.productosInteres,
      notas: p.notas,
      vendedor: p.vendedor,
      createdAt: parseDate(p.fecha) || Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: 'migration',
    });
  }

  await batch.commit();
  console.log(`Migrated ${prospectos.length} prospectos to Firestore.`);
}

migrate().catch(console.error);
