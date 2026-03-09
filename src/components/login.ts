import { signInWithPopup } from 'firebase/auth';
import { collection, getDocs, query, limit as fbLimit } from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase';
import { showToast } from '../lib/toast';
import { getUsuario } from '../lib/usuarios';

export function renderLogin(container: HTMLElement) {
  container.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <img src="logo.svg" alt="Lahuen" class="login-logo" />
        <h1 class="login-title"><span>APP</span></h1>
        <p class="login-subtitle">Inicia sesion con tu cuenta de Google</p>
        <button class="btn btn-primary login-btn" id="google-login">
          Iniciar con Google
        </button>
        <p class="login-footnote">Solo cuentas autorizadas del equipo</p>
      </div>
    </div>
  `;

  document.getElementById('google-login')!.addEventListener('click', async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user.email || '';

      // Check dynamic list first
      const usuario = await getUsuario(email).catch(() => null);
      if (usuario) return; // Authorized via usuarios collection

      // Fallback: test if server-side legacy rules grant access
      try {
        await getDocs(query(collection(db, 'productos'), fbLimit(1)));
        // Legacy authorized — Firestore rules allowed the read
      } catch (probeErr: unknown) {
        const probeMsg = probeErr instanceof Error ? probeErr.message : '';
        if (probeMsg.includes('INTERNAL ASSERTION') || probeMsg.includes('is not a function')) {
          // Corrupted IndexedDB — auto-recovery handler in main.ts will reload
          showToast('Recargando...', 'info');
          return;
        }
        await auth.signOut();
        showToast('Email no autorizado', 'error');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al iniciar sesion';
      showToast(msg, 'error');
    }
  });
}
