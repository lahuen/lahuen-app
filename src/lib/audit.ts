import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db, auth } from './firebase';

export async function logAudit(
  action: 'create' | 'update' | 'delete',
  col: 'prospectos' | 'productos',
  docId: string,
  docLabel: string,
  changes?: string,
): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await addDoc(collection(db, 'audit_log'), {
      action,
      collection: col,
      docId,
      docLabel,
      userEmail: user.email || '',
      userId: user.uid,
      timestamp: Timestamp.now(),
      ...(changes ? { changes } : {}),
    });
  } catch (err) {
    console.warn('logAudit failed:', (err as Error).message);
  }
}
