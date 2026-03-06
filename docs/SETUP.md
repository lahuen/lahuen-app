# Setup Manual — Lahuen CRM

Cuenta Firebase: **cbd.preparados@gmail.com**

---

## 1. Firebase Console (console.firebase.google.com)

Loguearse con `cbd.preparados@gmail.com` y crear proyecto nuevo.

### 1a. Crear proyecto
- Nombre sugerido: `lahuen-crm`
- Habilitar Google Analytics (opcional)

### 1b. Upgrade a Blaze (pay-as-you-go)
- **Requerido** para Gemini AI via `firebase/ai` SDK
- Billing > Upgrade > Vincular tarjeta
- Presupuesto sugerido: alertar a $5 USD

### 1c. Habilitar Authentication
- Authentication > Sign-in method > Google > Enable
- Authorized domains: agregar `lahuen.github.io` (o el dominio custom)

### 1d. Crear Firestore Database
- Firestore Database > Create database
- Location: `southamerica-east1` (San Pablo, mas cercano a Argentina)
- Start in **production mode** (las rules del repo se deployan por CI)

### 1e. Habilitar Vertex AI / Firebase AI
- Build > AI > Get started
- Habilitar la API de Vertex AI (necesario para `firebase/ai` SDK)

### 1f. Registrar Web App
- Project Overview > Add app > Web (icono `</>`)
- Nombre: `lahuen-crm-web`
- **NO** habilitar Firebase Hosting (usamos GitHub Pages)
- Copiar los valores del `firebaseConfig` que aparecen

---

## 2. Secrets para `.env` local

Crear `/Users/max/Projects/lahuen/lahuen-app/.env` con los valores del paso 1f:

```
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=lahuen-crm.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=lahuen-crm
VITE_FIREBASE_STORAGE_BUCKET=lahuen-crm.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

> No se necesita API key de Gemini. El SDK `firebase/ai` usa las credenciales del proyecto Firebase directamente.

---

## 3. GitHub Secrets (para CI/CD)

Repo: `github.com/lahuen/lahuen-app` > Settings > Secrets and variables > Actions

### 3a. Secrets del build (mismos valores que .env):

| Secret name | Valor |
|---|---|
| `VITE_FIREBASE_API_KEY` | `AIza...` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `lahuen-crm.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `lahuen-crm` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `lahuen-crm.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `123456789` |
| `VITE_FIREBASE_APP_ID` | `1:123456789:web:abc123` |

### 3b. Firebase Token (para deploy de Firestore rules):

```bash
npx firebase-tools login:ci
```

Loguearse con `cbd.preparados@gmail.com`, copiar el token y guardarlo como:

| Secret name | Valor |
|---|---|
| `FIREBASE_TOKEN` | `1//0a...` (token largo) |

---

## 4. Firebase CLI local (para deploy manual de rules)

```bash
npx firebase-tools login
# Loguearse con cbd.preparados@gmail.com
```

Crear `.firebaserc` en el root del proyecto:

```json
{
  "projects": {
    "default": "lahuen-crm"
  }
}
```

> Reemplazar `lahuen-crm` con el Project ID real si es diferente.

---

## 5. GitHub Pages

- Repo Settings > Pages > Source: **GitHub Actions**
- El workflow `.github/workflows/deploy.yml` ya esta configurado

---

## 6. Dominio custom (opcional)

Si se quiere usar `crm.lahuen.ar` u otro:
- GitHub repo > Settings > Pages > Custom domain
- Configurar DNS CNAME apuntando a `lahuen.github.io`
- Agregar el dominio en Firebase Auth > Authorized domains

---

## Checklist rapido

- [ ] Proyecto Firebase creado con `cbd.preparados@gmail.com`
- [ ] Plan Blaze activado
- [ ] Google Auth habilitado + dominio autorizado
- [ ] Firestore creado en `southamerica-east1`
- [ ] Vertex AI / Firebase AI habilitado
- [ ] Web App registrada, valores copiados
- [ ] `.env` local creado con los 6 valores
- [ ] 7 GitHub Secrets configurados (6 VITE_ + FIREBASE_TOKEN)
- [ ] `.firebaserc` creado con el Project ID
- [ ] GitHub Pages source = GitHub Actions
