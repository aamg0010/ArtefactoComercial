# try! Comercial — Fase 1

Base de la aplicación interna de gestión comercial de try! company. Esta fase incluye autenticación, modelo de datos, catálogo inicial, CRUD de empresas/contactos e importación CSV deduplicada.

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

No hay cron aplicable todavía: el rastreo diario se incorpora en la Fase 4. Por ello tampoco hay tareas, cadencias, lista de exclusión ni envíos que verificar en esta fase.

## Decisiones y pendientes

- Auth.js con credenciales locales de desarrollo y Google opcional; PostgreSQL + Prisma como almacenamiento principal.
- Los datos de `data/prospectos.json` son la fuente de verdad. El seed preserva sus datos sin completarlos ni corregirlos y guarda los cinco guiones como versión 1, autor `seed`.
- Pendientes: proveedor PostgreSQL desplegado, OAuth Google, adaptadores de fuentes, cron/cola, IA, email/calendario y controles completos de RGPD/habeas data de la Fase 6.
