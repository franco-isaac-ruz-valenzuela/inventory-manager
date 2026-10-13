# Instalación y despliegue

Requiere Node compatible con Next.js 16 (mínimo 20.9), npm y Java 21 para pruebas
de reglas. Usar una versión LTS vigente compatible y consultar `package.json`.

```powershell
npm.cmd ci
Copy-Item .env.example .env.local
# Completar la configuración antes de iniciar.
npm.cmd run dev -- --port 3001
```

No sobrescribir un `.env.local` existente sin revisar. Variables necesarias:

```text
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

Obtenerlas de la aplicación web Firebase correspondiente. `NEXT_PUBLIC_*` se
incorpora al cliente: no colocar claves privadas, cuentas de servicio ni tokens.
`.env.local` está ignorado por Git. Configurar todas las variables para evitar
valores de respaldo de otro proyecto. API key y project ID son obligatorios.

## Entornos

| Entorno | Comando / salida |
| --- | --- |
| Desarrollo | `npm.cmd run dev -- --port 3001`; `.next` |
| Build local | `npm.cmd run build`; `.next-production` |
| Servidor de build | `npm.cmd run start -- --port 3002` tras compilar |
| Emulador de reglas | `npm.cmd run test:security`; 8086, `demo-leker-security` |
| Vercel | Integración de `main`; `.next` cuando `VERCEL=1` |

Localhost usa la base indicada en `.env.local`: no significa datos aislados.
Usar un proyecto separado para pruebas de escritura. Confirmar el identificador
productivo en la configuración de Firebase. Las pruebas del emulador no usan ese proyecto.

## Publicar

1. Revisar diff, documentación, configuración y usuarios que conservarán acceso.
2. Ejecutar [verificaciones](PRUEBAS_Y_CAMBIOS.md).
3. Planear código, reglas y migraciones conjuntamente; no hay coordinación automática
   que evite toda ventana de incompatibilidad.
4. Commit de archivos revisados y push a `main`:

```powershell
git status
git add RUTAS_REVISADAS
git commit -m "Descripción del cambio"
git push origin main
```

5. Esperar éxito de Vercel para ese commit; revisar dominio y variables Production.
6. Si cambian reglas, publicarlas por separado:

```powershell
.\node_modules\.bin\firebase.cmd login
.\node_modules\.bin\firebase.cmd projects:list
.\node_modules\.bin\firebase.cmd deploy --only firestore:rules --project ID_REAL_DEL_PROYECTO
```

7. Comprobar login, permisos, rutas, CSS/JS y flujos afectados.
8. Registrar commit, pruebas y despliegue. Un HTTP 200 no prueba operaciones autenticadas.

GitHub/Vercel publica código, no reglas Firestore. La sesión CLI administrativa
no concede acceso de usuario dentro de la aplicación.

## Revertir

Revisar compatibilidad antes de promover una versión anterior o revertir un commit.
Las reglas y los datos tienen ciclos separados; clientes antiguos pueden ser
incompatibles. No abrir acceso general para hacerlos funcionar. No usar push
forzado como mecanismo habitual. Revertir código no restaura existencias ni bajas.
