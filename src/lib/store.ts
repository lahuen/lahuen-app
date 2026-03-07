import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import type { Producto, Lote } from './types';

type Listener = () => void;

let productos: (Producto & { id: string })[] = [];
let lotes: (Lote & { id: string })[] = [];
let initialized = false;

const listeners = new Set<Listener>();

export function getProductos() { return productos; }
export function getLotes() { return lotes; }

/** Subscribe to data changes. Returns unsubscribe function. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() { listeners.forEach(fn => fn()); }

/** Start global Firestore listeners (called once on auth) */
export function initStore() {
  if (initialized) return;
  initialized = true;

  onSnapshot(
    query(collection(db, 'productos'), orderBy('nombre')),
    (snap) => {
      productos = snap.docs.map(d => ({ id: d.id, ...d.data() } as Producto & { id: string }));
      notify();
    },
    (err) => console.error('store productos:', err),
  );

  onSnapshot(
    query(collection(db, 'lotes')),
    (snap) => {
      lotes = snap.docs.map(d => ({ id: d.id, ...d.data() } as Lote & { id: string }));
      notify();
    },
    () => { /* lotes not available yet */ },
  );
}
