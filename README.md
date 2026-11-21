# try! Comercial — Fases 1 y 2

Aplicación interna de gestión comercial de try! company: autenticación, catálogo inicial, empresas/contactos, importación CSV, cadencias y tareas, registro de resultados, Mi día y pipeline kanban.

## Requisitos e instalación

- Node.js 20+ y PostgreSQL 15+.
- Copia `.env.example` a `.env` y configura `DATABASE_URL` y `AUTH_SECRET`.

```bash
npm install
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run prisma:seed
npm run dev
```

Abre `http://localhost:3000`. Usuarios seed: `admin@try.company` y `comercial@try.company`. Define `SEED_ADMIN_PASSWORD` y `SEED_SALES_PASSWORD` antes de ejecutar el seed. El seed es idempotente y carga exactamente las 56 empresas y los 5 guiones de `data/`; no crea empresas ficticias.

Para activar Google, define `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. No se necesita ninguna API externa para la Fase 1.

## CSV

Formato UTF-8 con cabeceras: `nombre,pais,nifNit,web,email,telefono,region,ciudad,sector,contacto,cargo,emailContacto`. `pais` admite `ES` o `CO`. Hay un ejemplo descargable desde la propia aplicación.

La importación valida con Zod y evita duplicados por NIF/NIT, dominio web o nombre normalizado + país. Los contactos importados llevan origen, base legal pendiente y, si incluyen email personal, consentimiento pendiente. No hay envío de emails en esta fase.

La hoja de seguimiento se puede reimportar de forma idempotente (por `id`, o por nombre normalizado y país) con:

```bash
npm run import:sheet -- ruta/a/exportacion.csv
```

## Calidad y comandos

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

Las pruebas de integración solo se ejecutan con una `TEST_DATABASE_URL` distinta de `DATABASE_URL` y cuyo nombre de base termine en `_test`. Si falta o es insegura, se omiten sin abrir una conexión. La suite limpia los datos de esa base desechable antes de sembrar; nunca debe usarse una base de trabajo.

En PowerShell, con PostgreSQL del proyecto en el puerto 54329:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://try:try@localhost:54329/try_comercial_test?schema=public'
# Para aplicar las migraciones, Prisma requiere DATABASE_URL en este subproceso:
node -e "require('child_process').spawnSync('npx.cmd', ['prisma', 'migrate', 'deploy'], {shell: true, stdio: 'inherit', env: {...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL}})"
npm test -- --reporter=verbose > test-output.log 2>&1
```

## Prueba E2E de Fase 2

Con el PostgreSQL del proyecto accesible en `localhost:54329` (usuario y contraseña locales `try`), ejecuta:

```powershell
# Sólo es necesario instalar Chromium la primera vez:
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.cache/ms-playwright"
npx playwright install chromium
npm run test:e2e > e2e-output.log 2>&1
```

`test:e2e` crea `try_comercial_e2e` si falta, aplica `migrate deploy`, limpia sus empresas, tareas, actividades, cadencias y supresiones y ejecuta `prisma/seed-real.ts`. Después Playwright compila la aplicación y la sirve en `http://localhost:3100`, con credenciales y configuración de Auth.js exclusivas de prueba. El puerto 3100 debe estar libre: no se reutiliza ningún servidor existente.

El `webServer` ejecuta `next build` y después `next start -p 3100`. Un lanzador registra el PID del servidor de esta ejecución para cerrarlo al terminar, también en Windows restringido sin permisos para `taskkill /T`.

La URL predeterminada es `postgresql://try:try@localhost:54329/try_comercial_e2e?schema=public`. Se puede configurar mediante `E2E_DATABASE_URL`, pero debe terminar en `_e2e` y ser distinta de `DATABASE_URL`, incluso si sólo cambian los parámetros de conexión. La protección se valida antes de crear, migrar o borrar datos. Las pruebas de integración usan exclusivamente `try_comercial_test`; E2E usa exclusivamente `try_comercial_e2e`.

La prueba usa Chromium y un solo worker: login comercial → guion de La Calandina en Mi día del 23/11/2026 → Reunión agendada en Caspe → desaparición de sus pendientes → columna Reunión del kanban → redirección a login sin sesión. No envía emails. La caché del navegador se guarda en `.cache/ms-playwright/` (o en `PLAYWRIGHT_BROWSERS_PATH` si se configura). Si falla, conserva traza y captura en `test-results/`; el informe HTML está en `playwright-report/` (`npx playwright show-report`). Esos directorios y `e2e-output.log` están ignorados por Git.

No hay cron aplicable todavía: el rastreo diario se incorpora en la Fase 4.

## Decisiones y pendientes

- Auth.js con credenciales locales de desarrollo y Google opcional; PostgreSQL + Prisma como almacenamiento principal.
- Los datos de `data/prospectos.json` son la fuente de verdad. El seed preserva sus datos sin completarlos ni corregirlos y guarda los cinco guiones como versión 1, autor `seed`.
- Pendientes: proveedor PostgreSQL desplegado, OAuth Google, adaptadores de fuentes, cron/cola, IA, email/calendario y controles completos de RGPD/habeas data de la Fase 6.
