import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import type { Usuario } from './types';

/** Returns the Usuario doc for the given email, or null if not a team member. */
export async function getUsuario(email: string): Promise<Usuario | null> {
  const snap = await getDoc(doc(db, 'usuarios', email));
  if (!snap.exists()) return null;
  return snap.data() as Usuario;
}

/** Returns all users (admin use). */
export async function getAllUsuarios(): Promise<(Usuario & { id: string })[]> {
  const snap = await getDocs(collection(db, 'usuarios'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Usuario & { id: string }));
}
