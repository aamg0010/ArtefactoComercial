# try! Comercial — Fases 1 a 4

Aplicación interna de gestión comercial de try! company: autenticación, catálogo inicial, empresas/contactos, importación CSV, cadencias y tareas, registro de resultados, Mi día, pipeline kanban e investigación/puntuación/guiones con IA o proveedor simulado.

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

El rastreo diario de Fase 4 se programa explícitamente; instalar la aplicación no crea ninguna tarea de Windows.

## Fase 3: investigación, puntuación y guiones

Abre una empresa desde la lista, Mi día o Pipeline. En su ficha puedes investigar, consultar evidencias y versiones anteriores, aplicar la prioridad sugerida, generar un guion borrador y aprobar su última versión. La generación no crea tareas; la aprobación crea la cadencia estándar y sus seis tareas, asignadas a quien aprueba, desde la próxima acción o desde hoy (fecha de Madrid almacenada a medianoche UTC). Reaprobar no duplica tareas. Si hay supresión por empresa, email o teléfono, la cadencia queda pausada sin tareas.

### Configuración de IA

Variables disponibles en `.env.example` (no se necesitan claves para desarrollar o probar):

| Variable | Uso |
| --- | --- |
| `LLM_PROVIDER` | `mock`, `anthropic` u `openai`. Vacío equivale a `mock`. |
| `LLM_MODEL` | Identificador del modelo del proveedor. Si falta: `claude-sonnet-4-5` o `gpt-4.1-mini`. |
| `ANTHROPIC_API_KEY` | Clave sólo de servidor para Anthropic. |
| `OPENAI_API_KEY` | Clave sólo de servidor para OpenAI. |

Sin la clave del proveedor seleccionado se usa siempre `mock`, determinista y sin llamadas a servicios de IA, y aparece el aviso **IA en modo simulado**. Para activar IA real, configura el proveedor, su clave y el modelo y reinicia/recompila el servidor; no hay que modificar código. Las pruebas fuerzan `mock`, incluso si hay claves configuradas. Los adaptadores reales usan `fetch` a [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create) y [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create), con validación Zod, timeout de 60 segundos por intento y dos reintentos (esperas de 1 y 2 segundos). La operación completa puede tardar varios minutos si el proveedor no responde: ajusta el límite de ejecución del alojamiento antes de desplegar IA real.

`AiRun` conserva proveedor/modelo, propósito, empresa, duración, tokens si existen y éxito/error saneado. Nunca almacena claves, prompts ni cuerpos de errores del proveedor. Los transportes reales están probados con respuestas HTTP simuladas; falta la comprobación operativa con credenciales reales.

### Evidencias y límites de descarga

El seed y `import:sheet` extraen webs de `contacto.texto`/`Contacto corporativo`. Priorizan dominios explícitos; si sólo hay correo corporativo, proponen su dominio (excluyendo proveedores personales como Gmail, Hotmail, Yahoo u Outlook). Guardan una URL candidata con protocolo y su dominio normalizado sólo si `Company.website` está vacío; no sustituyen una web informada. Los registros existentes se completan al reejecutar el seed o reimportar. Una web sola no es un canal directo, no marca el contacto como verificado y aporta cero al factor de accesibilidad, con el texto «Sin canal de contacto directo».

La investigación consulta únicamente home y enlaces de contacto/quiénes somos de la propia web, sin ejecutar JavaScript: máximo tres páginas, 200 KiB por página y 15 segundos por solicitud, con `User-Agent: try-comercial-bot`. Consulta robots.txt antes de descargar; ante un fallo distinto de 404 no rastrea. Admite redirecciones canónicas entre el mismo dominio con/sin `www` y de HTTP a HTTPS. Consulta robots.txt del nuevo origen antes de seguir y vuelve a validar/fijar su DNS público; rechaza otros dominios, subdominios arbitrarios, credenciales, puertos no estándar y downgrades a HTTP. Puede omitir webs con contenido dinámico o protección antibots; en ese caso lo indica y usa los datos del CRM.

Las redirecciones se prueban con respuestas web simuladas. El E2E comprueba la web y el contacto de Limabril; para mantener el flujo sin web de Pretersa independiente de Internet, verifica primero su dominio inferido y vacía temporalmente su web sólo en la base E2E, restaurándola al terminar.

Las fuentes web llevan URL, fecha y texto extraído; la evidencia local usa un identificador `urn:try-comercial:company:...` y fecha del snapshot. Toda afirmación lleva citas o estado `estimado`/`pendiente de verificar`; los hechos verificados requieren un extracto literal. La validación rechaza fuentes alteradas, roles con nombres personales, nombres compuestos y cifras ausentes de las evidencias. Estas comprobaciones son conservadoras y no sustituyen la revisión humana. El mock no confirma hechos externos ni señales de intención: usa datos del CRM e hipótesis explícitas.

Cada investigación añade `ResearchReport` y `Score` sin sobrescribir versiones. La IA propone tres factores (sector, tamaño, intención); el código determina contacto, proximidad para soporte in situ y venta cruzada. Los pesos de `ScoringWeights` se normalizan a 100: sector 25, tamaño 15, intención 20, contacto 15, proximidad 15, venta cruzada 10. Se pueden modificar en la tabla (valores no negativos y suma positiva); el seed no sobrescribe pesos existentes. A ≥ 70, B entre 40 y 69 y C < 40. La prioridad actual sólo cambia al pulsar **Aplicar prioridad sugerida**, con registro de auditoría.

Las cinco plantillas de `data/guiones.json` se cargan en `Template`; el seed no sobrescribe modificaciones posteriores. El guion se guarda versionado con autor `IA` y estado `BORRADOR`. Conserva `[TELÉFONO]` y `[WEB]`, identificación de try! company, motivo y opción BAJA. Aprobar planifica llamadas/emails, pero no envía ningún mensaje ni sustituye la revisión de su base legal.

### Investigación masiva

```powershell
# Comprueba primero DATABASE_URL; para validar usa sólo la base desechable:
$env:DATABASE_URL = 'postgresql://try:try@localhost:54329/try_comercial_test?schema=public'
$env:LLM_PROVIDER = 'mock'
npm run research:batch
```

El lote procesa como máximo tres empresas simultáneamente y espera un segundo entre tandas. Sólo selecciona empresas sin ficha con origen `AI`; al relanzar omite los éxitos y reintenta los fallos. El diario de Fase 4 limita además la investigación automática a nuevas empresas no ficticias de la cola. No se ha ejecutado contra la base de trabajo.

La migración `20261121140000_phase3_ai` se genera con `prisma migrate diff` contra una base de sombra, sin BOM. Aplícala con `prisma migrate deploy` apuntando explícitamente a la base deseada antes de ejecutar el seed. Vitest mantiene los tests de Fase 2 y añade puntuación, evidencias, proveedor simulado/transportes, lote e integración de investigación → puntuación → borrador → aprobación/supresión. `npm run test:e2e` mantiene el flujo de Caspe y añade Pretersa-Prenavisa → investigación → puntuación → guion → aprobación → tareas en Mi día.

## Fase 4: rastreo y perfiles

En **Rastreo** (`/rastreo`), administración puede crear/editar perfiles y activarlos o desactivarlos; administración y comerciales pueden ejecutar perfiles activos. Dirección sólo puede consultar. El seed añade tres ejemplos **inactivos** para agroalimentaria del Bajo Aragón, ganadería de Teruel/Zaragoza y pymes de servicios de Alcañiz. Se conservan las modificaciones posteriores a los perfiles.

Cada perfil define país, provincias, comarcas, municipios, palabras clave/sector, CNAE opcional, producto, fuente y límite de 1–200 candidatos por ejecución. Las consultas combinan palabra clave, municipio y provincia; Google se filtra por el país y localidades seleccionadas. Comarca y CNAE son metadatos del perfil: Places no proporciona un filtro CNAE. El presupuesto evita búsquedas ilimitadas: hasta 20 consultas por perfil y `GOOGLE_PLACES_MAX_PAGES` páginas por consulta (opcional, por defecto 3, rango 1–10), parando al alcanzar el máximo de resultados.

### Fuentes

- `google-places`: API New `POST https://places.googleapis.com/v1/places:searchText`, field mask explícita (identificador, datos corporativos, atribuciones y token), paginación, timeout de 15 s y dos reintentos ante red/429/5xx con esperas de 1 y 2 s. Un error no cambia a datos simulados. No se solicitan personas, emails, reseñas ni sus autores.
- `mock`: sin clave de Google, las fuentes Google/mock devuelven empresas deterministas con `[SIMULADA]`, `fictional=true` y webs `.example.invalid`. No usa red ni teléfonos reales. Con clave, incluso un perfil configurado como mock selecciona Google real; nunca se mezclan resultados reales y simulados.
- `csv`: pega un CSV propio en el perfil. Reutiliza `parseCompanyCsv` (también `empresa,provincia,municipio`), pero conserva sólo los campos corporativos; descarta columnas de contactos personales y emails. `telefono` debe ser el teléfono corporativo. En ejecuciones posteriores reutiliza esa selección corporativa, no el CSV original. Los CSV no tienen una URL pública inventada.
- `apollo`, `einforma`, `rues`, `linkedin-export`: stubs con interfaz/TODO, sin red; registran `SOURCE_NOT_IMPLEMENTED` en el historial. LinkedIn queda limitado a exportación manual de empresas, sin scraping de personas.

Para activar Google, habilita Places API (New)/facturación en su proyecto, limita la clave a esa API y configura `GOOGLE_PLACES_API_KEY` en el entorno del servidor; no se necesita cambiar código. Las pruebas fuerzan clave vacía y simulan las respuestas HTTP del adaptador real.

**Retención de Google:** el `place_id` (`CompanySource.sourceRef`) se conserva; el resto de contenido de Places **no debe cachearse indefinidamente**, ni se presume permitido guardarlo durante 30 días. Por eso el CRM persiste sólo el identificador y metadatos propios del perfil. El nombre real, dirección, web y teléfono se consultan en vivo, sin caché, al abrir la ficha; web/teléfono sirven para contactar a la empresa tras verificar su uso corporativo. Se muestran logo y atribuciones. Consulta las [políticas de Places](https://developers.google.com/maps/documentation/places/web-service/policies), incluidas las condiciones EEE. Antes de producción deben publicarse los términos/privacidad exigidos por Google.

Las altas de Google muestran inicialmente un nombre local de referencia con el perfil y el identificador, sin copiar nombres/direcciones/teléfonos de Places al catálogo ni a los logs. Su información debe verificarse de manera independiente para incorporarla como dato propio; tampoco se envía contenido de Google al proveedor de IA. No se ha probado con una clave real todavía. La integración técnica sigue la [documentación oficial de Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search).

### Ejecución, exclusión y cola

`runProspecting(profileId?)` ejecuta sólo perfiles activos. Registra un `SourceRun` con inicio/fin, fuente efectiva, consultas propias, candidatos, nuevas, duplicadas, suprimidas, errores y coincidencias por identificador (sin respuestas completas ni claves). Deduplica por NIF, dominio sin `www`, referencia de la misma fuente o nombre sin forma jurídica + municipio + país. La sección local de deduplicación/alta se serializa con un advisory lock transaccional de PostgreSQL para evitar duplicados entre ejecuciones concurrentes; no mantiene un bloqueo durante las llamadas de red.

Las altas quedan en Detectada, sin prioridad ni tareas, con fecha de detección y contacto genérico corporativo pendiente de verificar/base legal pendiente de revisar. Se crea la oportunidad del producto objetivo. La exclusión consulta empresa, nombre/municipio, dominio y teléfono normalizado. Una marca de exclusión se conserva al borrar la empresa; sus referencias de fuente quedan bloqueadas para no recrearla. No se realizan envíos ni llamadas.

`researchQueuedAt` es la cola persistente: investigar con éxito la vacía. El diario sólo procesa nuevas empresas no ficticias en cola y sin ficha de IA; con IA simulada difiere la investigación. `research:batch` manual mantiene su comportamiento de investigar todas las empresas sin ficha. Repetir el rastreo no duplica compañías ni tareas.

```powershell
# Verificación local exclusivamente contra la base desechable:
$env:DATABASE_URL = 'postgresql://try:try@localhost:54329/try_comercial_test?schema=public'
$env:LLM_PROVIDER = 'mock'
$env:GOOGLE_PLACES_API_KEY = ''
npm run prospect:daily
```

### Programar a las 06:30 en Windows

Comprueba primero la base del entorno que ejecutará el proceso y los perfiles activos. El proceso debe tener Node/npm disponibles, acceso a PostgreSQL y permisos de lectura sobre la configuración local. La hora corresponde a la zona local de Windows; los cambios de horario los administra el Programador.

Opción recomendada (archivo preparado, **no ejecutado durante esta entrega**):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-daily-task.ps1
```

El script registra `try-comercial-diario` con directorio de trabajo correcto, ejecución diaria a las 06:30 e ignorando solapamientos. Alternativa equivalente mediante `schtasks`, adaptando la ruta del repositorio:

```powershell
schtasks /Create /TN 'try-comercial-diario' /SC DAILY /ST 06:30 /TR 'cmd.exe /d /c "cd /d C:\Users\Nitropc\Projects\ArtefactoComercial && npm run prospect:daily"' /F
schtasks /Query /TN 'try-comercial-diario'
# Para desregistrarla:
schtasks /Delete /TN 'try-comercial-diario' /F
```

El script diario ejecuta el rastreo y, sólo con IA real, la investigación de la cola. Devuelve código distinto de cero si hay errores; revisa `SourceRun` para el detalle saneado. No se ha registrado ni ejecutado una tarea programada en esta máquina.

La migración `20261121160000_phase4_prospecting` se genera con `migrate diff`, sin BOM. Incluye `SearchProfile`, `SourceRun`, identidades de fuente y metadatos de detección/cola; añade en SQL los checks y el trigger de conservación de exclusiones. El índice único de nombre/país pasa a incluir municipio, para permitir empresas homónimas en localidades distintas. Aplica `migrate deploy` y ejecuta el seed en la base elegida antes de usar `/rastreo`.

## Decisiones y pendientes

- Auth.js con credenciales locales de desarrollo y Google opcional; PostgreSQL + Prisma como almacenamiento principal.
- Los datos de `data/prospectos.json` son la fuente de verdad. El seed preserva sus datos sin completarlos ni corregirlos y guarda los cinco guiones como versión 1, autor `seed`.
- Pendientes: validación con credenciales reales de Google/IA, despliegue PostgreSQL/OAuth, adaptadores comerciales hoy stub, integraciones email/calendario y controles completos de Fase 6. La programación diaria local y la cola persistente ya están implementadas.
