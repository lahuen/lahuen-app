import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { showToast } from '../lib/toast';

const ALLOWED_EMAILS = [
  'cbd.preparados@gmail.com',
  'gmedina86@gmail.com',
  'fefox911@gmail.com',
  'lahuencoop@gmail.com',
  'rodrigocbdthc@gmail.com',
  'walter.medina.pourcel@gmail.com',
];

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
      if (!ALLOWED_EMAILS.includes(email)) {
        await auth.signOut();
        showToast('Email no autorizado', 'error');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al iniciar sesion';
      showToast(msg, 'error');
    }
  });
}
