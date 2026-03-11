import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from './firebase';
import type { Producto, Lote, Prospecto, Movimiento } from './types';

export type StoreCollection = 'productos' | 'lotes' | 'prospectos' | 'movimientos';
type Listener = (changed: StoreCollection) => void;

let productos: (Producto & { id: string })[] = [];
let lotes: (Lote & { id: string })[] = [];
let prospectos: (Prospecto & { id: string })[] = [];
let movimientos: (Movimiento & { id: string })[] = [];
let initialized = false;

const listeners = new Map<Listener, StoreCollection[] | null>();

export function getProductos() { return productos; }
export function getLotes() { return lotes; }
export function getProspectos() { return prospectos; }
export function getMovimientos() { return movimientos; }
export function isReady() { return initialized; }

/**
 * Subscribe to data changes. Returns unsubscribe function.
 * @param fn - Callback receiving which collection changed
 * @param collections - Optional filter: only fire for these collections. Null = all.
 */
export function subscribe(fn: Listener | (() => void), collections?: StoreCollection[]): () => void {
  listeners.set(fn as Listener, collections || null);
  return () => { listeners.delete(fn as Listener); };
}

function notify(changed: StoreCollection) {
  listeners.forEach((filter, fn) => {
    if (!filter || filter.includes(changed)) fn(changed);
  });
}

/** Start global Firestore listeners (called once on auth) */
export function initStore() {
  if (initialized) return;
  initialized = true;

  onSnapshot(
    query(collection(db, 'productos'), orderBy('nombre')),
    (snap) => { productos = snap.docs.map(d => ({ id: d.id, ...d.data() } as Producto & { id: string })); notify('productos'); },
    (err) => console.error('store productos:', err),
  );

  onSnapshot(
    query(collection(db, 'lotes')),
    (snap) => { lotes = snap.docs.map(d => ({ id: d.id, ...d.data() } as Lote & { id: string })); notify('lotes'); },
    () => {},
  );

  onSnapshot(
    query(collection(db, 'prospectos'), orderBy('createdAt', 'desc')),
    (snap) => { prospectos = snap.docs.map(d => ({ id: d.id, ...d.data() } as Prospecto & { id: string })); notify('prospectos'); },
    (err) => console.error('store prospectos:', err),
  );

  onSnapshot(
    query(collection(db, 'movimientos'), orderBy('fecha', 'desc'), limit(500)),
    (snap) => { movimientos = snap.docs.map(d => ({ id: d.id, ...d.data() } as Movimiento & { id: string })); notify('movimientos'); },
    (err) => console.error('store movimientos:', err),
  );
}
