# Integración try! Comercial ↔ trygestión (Fase 5)

> Estado: **aprobada por Andrés el 21/11/2026** (decisiones al final de la sección 6). Basada en la lectura (solo lectura) del código en producción de trygestión
> (`/var/www/vhosts/trycompany.es/httpdocs/gestion`, proceso Node en `127.0.0.1:3002`, publicado en
> `https://trygestion.com/gestion/api`) el 21/11/2026. No se ha modificado nada en producción.

## 1. Lo que ya existe en trygestión (y reutilizamos)

| Necesidad de la app comercial | Módulo de trygestión | Endpoints |
|---|---|---|
| Ficha de empresa | `empresas` | `GET/POST/PUT /api/empresas` (zod: nombre, cif/nif, dirección, cp, ciudad, provincia, país, teléfono, email, web, sector, notas) |
| Personas de contacto | `contactos` | `GET/POST/PUT /api/contactos` |
| Oportunidades y embudo | `pipeline` | `GET /etapas`, `POST /oportunidades`, `PUT /oportunidades/:id/etapa`, `PUT /oportunidades/:id/estado`, `POST /oportunidades/:id/convertir-proyecto` |
| Registro de llamadas, emails, reuniones | `pipeline` | `POST /oportunidades/:id/actividades` (tipo, título, descripción, fecha_programada) |
| Reuniones en calendario | `eventos` | `POST /api/eventos` → se sincroniza solo con Google Calendar |
| Tareas internas | `tareas` | `POST /api/tareas` (solo para tareas que deban salir de la app comercial) |
| Envío de email por el SMTP del tenant | `services/emailTenant.ts` | `enviarEmailTenant(tenantId, …)` — **no tiene endpoint propio** |
| IA con la clave del tenant | `routes/ia.ts` | clave en `config.openai_api_key` por tenant — **no hay endpoint de generación JSON** |

Hay dos sistemas de oportunidades (`crm_oportunidades` y `pipeline_oportunidades`). Usamos **`pipeline_*`**:
es el más nuevo, tiene etapas configurables, cadencias, dashboard y conversión a proyecto.
(Confirmado por Andrés: el equipo usa el Pipeline.)

## 2. Principios

1. **Una sola fuente de verdad por dato.** La app comercial es dueña de la *prospección* (rastreo, estudio,
   guiones, cadencias, tareas diarias, bajas). trygestión es dueña del *cliente* (empresa cualificada,
   oportunidad, reuniones, proyectos, facturas). No hay dos CRMs paralelos.
2. **Todas las empresas se empujan desde el inicio** (decisión de Andrés, 21/11). Al importar o aceptar
   una empresa, se crea en trygestión como empresa y oportunidad del Pipeline en la primera etapa
   ("Prospecto"). Antes de crearla se busca si ya existe (CIF, dominio web o nombre normalizado), para no
   duplicar clientes. En `notas` se marca su origen (`Origen: try! Comercial · prospecto · prioridad A/B/C`).
   Las empresas descartadas pasan a `estado: perdida` con el motivo, no se borran.
3. **Multitenant desde el día 1.** Todo va por tenant; la integración se podrá ofrecer a los licenciatarios.
4. **Las claves no salen de trygestión.** Ni la clave de OpenAI ni el SMTP viajan a la app comercial.
5. **Nada se envía sin aprobación humana** (RGPD, LSSI art. 21, Ley 1581): el endpoint de email exige el
   usuario que aprobó y el pie de BAJA.

## 3. Autenticación: token de servicio con alcance (nuevo)

Hoy existe el token de servicio de Cronos (`.cronos-api-token`): compara con `===`, **actúa como el CEO con
`es_superadmin: 1`** y elige tenant por cabecera. No lo reutilizamos. Propuesta:

- Tabla nueva `servicio_tokens` (id, tenant_id, usuario_id, nombre, token_hash SHA-256, scopes JSON,
  activo, last_used_at, created_at).
- Usuario técnico **"try! Comercial (servicio)"** en `tenant-try-legacy`, rol `empleado`, sin superadmin.
- En `autenticar`: si el Bearer empieza por `tgs_`, se busca por hash, comparación en tiempo constante,
  se comprueba que la ruta está en `scopes` y **se fija el tenant del token** (se ignora `X-Tenant-ID`).
- Alta/baja de tokens desde la pantalla de configuración del tenant (rol CEO). El token se muestra una vez.
- Scopes iniciales: `empresas`, `contactos`, `pipeline`, `eventos`, `comercial` (los dos endpoints nuevos).
- Recomendación aparte: migrar Cronos a este mismo mecanismo.

## 4. Endpoints nuevos en trygestión (mínimos)

Montados en `/api/comercial` (router nuevo, `requireModule('crm')` si aplica):

### `GET /api/comercial/estado`
Devuelve `{ tenant, smtp: bool, ia: bool, googleCalendar: bool, etapas: [...] }`. Sirve de comprobación de salud.

### `POST /api/comercial/email/enviar`
```json
{ "to": "...", "subject": "...", "html": "...", "text": "...",
  "approvedBy": "usuario@try", "externalRef": "task:<id>",
  "oportunidadId": "opcional", "unsubscribeUrl": "https://…/baja/<token>" }
```
- Rechaza si falta `approvedBy` o el pie de BAJA, o si el destinatario está en la lista de supresión del tenant.
- Envía con `enviarEmailTenant`, añade `List-Unsubscribe`.
- Registra una `pipeline_actividad` tipo `email` si hay oportunidad.
- Idempotente por `externalRef`: el mismo `externalRef` no se envía dos veces.
- Límite: 50 por hora por tenant.

### `POST /api/comercial/ia/generar`
```json
{ "system": "...", "prompt": "...", "schema": { /* JSON Schema */ }, "maxTokens": 2000 }
```
- Usa `openai_api_key` del tenant y responde `{ json, model, usage }`.
- Límite de uso por tenant y log de coste. La app comercial añade el proveedor `trygestion` a
  `src/lib/llm` (junto a `anthropic`, `openai` y `mock`).

## 5. Flujo de sincronización (app → trygestión)

| Evento en la app comercial | Acción en trygestión | Se guarda en la app |
|---|---|---|
| Empresa importada o aceptada (y carga inicial de las 56) | `POST empresas` (o enlaza si ya existe por CIF/web/nombre) + `POST contactos` + `POST pipeline/oportunidades` en la etapa "Prospecto" | `Company.trygestionEmpresaId`, `trygestionOportunidadId` |
| Cambio de prioridad o puntuación (A/B/C) | `PUT empresas/:id` (notas) y `PUT pipeline/oportunidades/:id` (probabilidad) | — |
| Reunión agendada | `POST eventos` (`ambito: externo`, `entidad_externa`) → Google Calendar | `Activity.trygestionEventoId` |
| Llamada/email registrado de una empresa ya sincronizada | `POST pipeline/oportunidades/:id/actividades` | `Activity.trygestionActividadId` |
| Cambio de etapa (Propuesta, Ganado, Perdido) | `PUT …/etapa` o `…/estado` | — |
| Baja (opt-out) | `POST /api/comercial/supresion` (email o dominio) | — |

- Cola `SyncOutbox` en la app (Postgres) con reintentos y backoff. Si trygestión está caído, la app sigue.
- Pantalla `/integracion` con estado, pendientes y errores.
- Lectura de vuelta (fase 5b): cada noche, `GET pipeline/oportunidades` de las sincronizadas para reflejar
  cambios hechos en trygestión.

## 6. Cambios necesarios

**En la app comercial (Codex, sin riesgo para producción):**
1. Cliente `src/lib/trygestion/` (fetch tipado, timeouts, errores) con `TRYGESTION_URL` y `TRYGESTION_TOKEN` en `.env`.
2. Modelo `SyncOutbox` y campos de enlace en Company, Contact y Activity (migración).
3. Proveedor LLM `trygestion` y envío de email vía trygestión.
4. Mock server de trygestión para los tests y E2E (nunca se toca producción en tests).

**En trygestión (requiere aprobación expresa de Andrés, backup previo y despliegue con su patrón `.deploy_prev`):**
1. Tabla `servicio_tokens` y la rama correspondiente en `middleware/auth.ts` y `middleware/tenant.ts`.
2. Router `routes/comercial.ts` con los 3 endpoints, más `POST /api/comercial/supresion` y la tabla
   `comercial_supresion` (tenant_id, valor, tipo email|dominio, motivo, created_at). El envío consulta esta tabla.
3. Pantalla para crear y revocar tokens.
4. Se prepara y prueba en local (torre), contra una base SQLite **creada desde el esquema** (`db/schema.ts`)
   con datos ficticios, sin copiar los datos reales de clientes. Solo se despliega con aprobación de Andrés,
   backup previo y plan de vuelta atrás.
5. Si no existe, se crea la etapa "Prospecto" del Pipeline en `tenant-try-legacy` (`POST /pipeline/etapas`)
   al activar la integración.

Decisiones (21/11): todas las empresas desde el inicio · Pipeline (`pipeline_*`) · cambios de trygestión
preparados y probados en copia antes de desplegar.

## 7. Estado del despliegue (21/11/2026)

- **trygestión en producción:** desplegados el token de servicio con alcance y `/api/comercial/*` (estado, email, IA, supresión, administración de tokens). Se sustituyeron solo 4 compilados de `dist/server` (verificados idénticos a lo que produce el compilador desde el `.ts` de producción) y se añadieron 4 nuevos. No se recompiló todo: había 8 `.ts` con cambios aún no desplegados (facturas, nóminas, paquetes, gestoría…).
- **Proceso PM2:** se llama `gestion-server` (los scripts de despliegue antiguos usan `try-gestion`).
- **Copia previa y vuelta atrás:** `httpdocs/gestion/.deploy_prev/comercial_20261121_154623/`, con la base copiada con `.backup` y `quick_check` correcto, y `rollback.sh`.
- **Tablas nuevas (vacías al crear):** `servicio_tokens`, `comercial_supresion`, `comercial_envios`, `comercial_ia_uso`.
- **Token:** se creó para `tenant-try-legacy` y está solo en el `.env` de la torre. En la base solo se guarda su hash.
- **Primera sincronización:** 56 empresas, 22 contactos y 56 oportunidades en *Prospecto*, sin errores. Ninguna coincidía con los 22 clientes existentes.
- **Aún desactivado:** `EMAIL_TRANSPORT=trygestion` y `LLM_PROVIDER=trygestion`. La sincronización periódica es manual (`npm run trygestion:sync` o *Procesar ahora*).
- **Código de trygestión:** no tiene repositorio git. Hay una copia versionada localmente en la torre (`Projects/trygestion-copia`) con estos cambios y sus tests.

### Hallazgos durante el despliegue
- `VACUUM INTO` sobre la base de producción falla en `pipeline_oportunidades` (23 columnas pero 24 valores). Indica una incoherencia del esquema de esa tabla que conviene revisar. `.backup` funciona y la copia pasa `quick_check`.
- En `server/` conviven `.js` compilados antiguos junto a los `.ts`. Producción ejecuta `dist/`, pero confunde a herramientas como Vitest.

## 8. Observaciones de seguridad (no bloquean)

- El token de Cronos suplanta al CEO con superadmin y se compara con `===`: conviene migrarlo a la sección 3.
- En `httpdocs/gestion` hay un `enable_banking.pem`. Hoy **no es accesible desde internet**: comprobado,
  todo redirige a `trygestion.com`, que sirve otra carpeta. Aun así, conviene moverlo fuera de `httpdocs`.
- En la raíz del vhost hay `.sql`, `.tgz` y scripts temporales de limpieza que convendría archivar.
- La contraseña de Plesk que quedó en el historial de Claude Code sigue pendiente de cambiar.
