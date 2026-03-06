/**
 * One-time seed: create usuarios collection in Firestore.
 * Usage:
 *   export GOOGLE_APPLICATION_CREDENTIALS=path/to/serviceAccountKey.json
 *   node scripts/seed-usuarios.mjs
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(
  readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'),
);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const usuarios = [
  { email: 'cbd.preparados@gmail.com',        nombre: 'CBD Preparados', role: 'admin' },
  { email: 'walter.medina.pourcel@gmail.com',  nombre: 'Walter',        role: 'admin' },
  { email: 'gmedina86@gmail.com',              nombre: 'German',        role: 'miembro' },
  { email: 'fefox911@gmail.com',               nombre: 'Fefox',         role: 'miembro' },
  { email: 'lahuencoop@gmail.com',             nombre: 'Lahuen Coop',   role: 'miembro' },
  { email: 'rodrigocbdthc@gmail.com',          nombre: 'Rodrigo',       role: 'miembro' },
];

async function seed() {
  const batch = db.batch();
  for (const u of usuarios) {
    batch.set(db.collection('usuarios').doc(u.email), u);
  }
  await batch.commit();
  console.log(`Seeded ${usuarios.length} usuarios.`);
}

seed().catch(console.error);
