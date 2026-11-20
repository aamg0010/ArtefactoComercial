# try! Comercial — Especificación para Codex

> Deja este archivo en la raíz del repositorio como `SPEC.md` (o cópialo dentro de `AGENTS.md`). Al final está el prompt de arranque para pegar en Codex.

---

## 1. Contexto y rol

Actúas como **ingeniero full-stack senior y arquitecto de producto** especializado en herramientas de ventas B2B (CRM, sales engagement, prospección). Vas a construir **try! Comercial**, la app interna de gestión comercial de **try! company (Try Business Solutions)**, una empresa de software con presencia en **España (Cataluña, Aragón)** y **Colombia (Antioquia, Córdoba)**.

### Portafolio que se vende (catálogo inicial, editable desde la app)

| Línea | Qué es | Cliente típico |
|---|---|---|
| **Ganadex** | Plataforma SaaS de gestión digital agro-ganadera | Explotaciones ganaderas, cooperativas, integradoras, veterinarias |
| **trygestión** | ERP de gestión empresarial general | Pymes de servicios, comercio, distribución |
| **Athenea** | ERP de trazabilidad integral para empresas productoras | Industria alimentaria, transformación, fabricación con lotes |
| **Soporte técnico** | In situ y remoto, mantenimiento, helpdesk | Pymes sin departamento TI |
| **Ciberseguridad** | Diagnóstico, auditoría de exposición, protección, copias, formación | Pymes con datos sensibles o obligaciones normativas |
| **Sistemas de gestión** | Implantación de procesos, ISO, digitalización | Empresas en crecimiento o certificándose |
| **Bots / IA** | Chatbots, automatizaciones, agentes | Empresas con atención al cliente o tareas repetitivas |

Principio comercial que debe impregnar todos los guiones: **el cliente no compra funcionalidades; compra productividad, rentabilidad, menos riesgo y mejor capacidad de decisión.**

---

## 2. Tarea

Construir una aplicación web que cubra el ciclo comercial completo de forma **diaria y automatizada**:

1. **Rastrear** empresas objetivo (prospectos) en los mercados definidos.
2. **Estudiarlas**: generar una ficha de investigación previa de cada una.
3. **Puntuarlas** y asignarles las líneas de producto más adecuadas.
4. **Generar guiones específicos** por empresa: llamada, email y seguimiento.
5. **Planificar cadencias** (secuencias multicanal) y agendar cada acción.
6. **Generar cada día** la lista de tareas con checks para el gestor comercial.
7. **Registrar resultados** y medir el embudo.

---

## 3. Especificaciones

### 3.1 Stack (por defecto; cambia solo si hay una razón clara y documéntala)

- **Frontend + backend:** Next.js 14+ (App Router) + TypeScript + Tailwind + shadcn/ui
- **Base de datos:** PostgreSQL (Supabase o Neon) con Prisma
- **Autenticación:** Supabase Auth o NextAuth (email + Google)
- **Trabajos programados:** cron diario (Vercel Cron / Supabase pg_cron / GitHub Actions) + cola de trabajos (pg-boss o Inngest)
- **IA:** capa `lib/llm.ts` agnóstica de proveedor (configurable por variable de entorno) para investigación, scoring y guiones
- **Email:** envío vía Gmail API / Microsoft Graph (desde el buzón real del comercial) o Resend/Brevo; tracking de aperturas opcional y desactivable
- **Calendario:** Google Calendar API (crear bloques de llamada y reuniones)
- **Despliegue:** Vercel + Supabase. Todo configurable por `.env`; incluir `.env.example`.

### 3.2 Módulos

#### A. Rastreo de empresas (Prospecting Engine)
- Fuentes conectables mediante **adaptadores** (`/lib/sources/*`), cada uno con la misma interfaz `search(criteria) → Company[]`:
  - Google Places API (empresas por categoría y municipio)
  - Importación CSV/XLSX (listados propios, ferias, asociaciones, cooperativas)
  - Adaptadores preparados (stubs con interfaz y TODO) para: Apollo, Einforma/SABI/Axesor (España), RUES / Cámaras de Comercio (Colombia), LinkedIn Sales Navigator (solo exportación manual)
  - Web scraping ligero **solo de la web pública de la propia empresa** (home, contacto, quiénes somos) respetando `robots.txt`
- **Perfiles de búsqueda (ICP)** guardables: país, región/provincia/departamento, sector (CNAE en España / CIIU en Colombia), tamaño, palabras clave, línea de producto objetivo.
- **Deduplicación** por NIF/NIT, dominio web y nombre normalizado.
- El cron diario ejecuta cada perfil activo y añade solo empresas nuevas.

#### B. Investigación previa (Research)
Para cada empresa nueva, generar una **ficha de estudio** con:
- Resumen de la empresa, actividad, tamaño estimado, ubicación
- Señales de oportunidad (contratación, expansión, web anticuada, sin certificados SSL, noticias, subvenciones digitalización/Kit Digital, normativa de trazabilidad, etc.)
- Dolores probables por sector
- Decisor probable y roles a contactar
- Líneas de try! recomendadas con justificación
- Fuentes usadas (URL + fecha). **Nunca inventar datos**: si algo no se ha verificado, marcarlo como "estimado" o "pendiente de verificar".

#### C. Scoring
- Puntuación 0–100 con pesos configurables: encaje sector (ICP), tamaño, señales de intención, accesibilidad del contacto, proximidad geográfica (para soporte in situ), oportunidad de venta cruzada.
- Clasificación A / B / C y prioridad en la cola diaria.

#### D. Generador de guiones
Por empresa y por línea de producto, generar y guardar (editables y versionados):
- **Guion de llamada en frío** con estructura ramificada: apertura (15 s), motivo, pregunta de diagnóstico, propuesta de valor según rol, manejo de objeciones típicas (precio, "ya tenemos", "no es el momento", "envíame info"), cierre con siguiente paso.
- **Email inicial** + 2–3 **emails de seguimiento** (asunto, cuerpo corto, una sola llamada a la acción).
- **Guion de seguimiento telefónico** y **mensaje de voz**.
- Adaptación por país (tuteo/usted, vocabulario España vs Colombia) y por rol del decisor (gerente, financiero, técnico, ganadero/productor).
- Biblioteca de **plantillas base** editable por el equipo; el generador personaliza sobre ellas, no desde cero.

#### E. Cadencias y agenda
- Cadencias configurables, p. ej.: Día 1 email → Día 3 llamada → Día 6 email de seguimiento → Día 10 llamada + voz → Día 15 email de cierre de ciclo.
- Cada paso se convierte en una **tarea fechada** asignada a un usuario.
- Pausa automática si la empresa responde, pide baja o se marca "no interesado".
- Reuniones agendadas → evento en Google Calendar.

#### F. Panel diario del gestor ("Mi día")
- Se regenera cada mañana (cron 07:00 hora local del usuario; España y Colombia tienen zona horaria distinta).
- Lista de tareas del día con **checkbox**, ordenada por prioridad: llamadas, emails para revisar y enviar, seguimientos, tareas vencidas.
- Cada tarea abre la ficha de la empresa con el guion listo, el historial y botones de resultado rápido: *Contactado / No contesta / Buzón / Interesado / Reunión agendada / No interesado / Baja*.
- Al marcar un resultado se genera automáticamente el siguiente paso de la cadencia.
- Resumen diario por email al gestor (y semanal al responsable): tareas hechas, pendientes, nuevas empresas, reuniones conseguidas.

#### G. Pipeline y métricas
- Kanban: Detectada → Investigada → En contacto → Reunión → Propuesta → Negociación → Ganada / Perdida.
- Métricas: empresas nuevas/día, tasa de contacto, tasa de respuesta email, reuniones, conversión por etapa, por línea de producto, por región y por comercial.
- Exportación CSV.

### 3.3 Modelo de datos mínimo
`Company`, `Contact`, `ResearchReport`, `Score`, `Product`, `Opportunity` (empresa × línea de producto), `Script` (versionado), `Template`, `Cadence`, `CadenceStep`, `Task`, `Activity` (llamada, email, nota, reunión), `SearchProfile`, `SourceRun` (log de cada ejecución del rastreo), `User`, `ConsentRecord`, `SuppressionList`.

### 3.4 Cumplimiento legal (obligatorio, no opcional)
- **España:** RGPD + LOPDGDD + **LSSI art. 21** (las comunicaciones comerciales por email requieren base legal adecuada; tratar el email frío con cautela). **Colombia:** Ley 1581 de 2012 (habeas data).
- Registrar el **origen** y la **base legal** de cada contacto.
- Preferir emails corporativos genéricos o contactos con interés legítimo documentado; marcar contactos personales como "requiere consentimiento".
- Todo email incluye identificación de try!, motivo del contacto y **enlace de baja** funcional.
- **Lista de exclusión** global consultada antes de cada envío y llamada.
- Opción de borrar/exportar los datos de una empresa o contacto.
- Ningún email se envía sin revisión humana en la v1 (modo "borrador → aprobar → enviar"). El envío automático solo se activa con un ajuste explícito.

### 3.5 Roles
- **Admin:** configura perfiles, pesos, plantillas, cadencias, integraciones.
- **Comercial:** trabaja su "Mi día", edita guiones, registra resultados.
- **Dirección:** solo lectura de métricas y pipeline.

---

## 4. Criterios de calidad

- Código TypeScript estricto, sin `any` innecesarios; validación con Zod en todas las entradas.
- Integraciones aisladas tras interfaces; la app funciona **sin ninguna API externa** usando importación CSV y datos de ejemplo.
- Idempotencia del cron: ejecutarlo dos veces el mismo día no duplica empresas ni tareas.
- Los guiones generados por IA citan la información de la ficha en la que se basan y nunca afirman datos no verificados del prospecto.
- Interfaz en español, responsive (el comercial la usará en el móvil durante las llamadas), accesible (contraste, teclado).
- Secretos solo en variables de entorno; nada de credenciales en el repositorio.
- Registro de auditoría de cada envío y cada cambio de estado.

---

## 5. Cómo debe ser la entrega

Trabaja en **fases**, con un commit/PR por fase, y no pases a la siguiente sin dejar la anterior funcionando:

1. **Fase 1 — Base:** proyecto, auth, modelo de datos, migraciones, seed con catálogo try! y 20 empresas de ejemplo (ficticias y marcadas como tales), CRUD de empresas/contactos, importación CSV.
2. **Fase 2 — Tareas y "Mi día":** cadencias, generación de tareas, panel diario con checks, registro de resultados, pipeline kanban.
3. **Fase 3 — IA:** investigación, scoring y generador de guiones/plantillas.
4. **Fase 4 — Rastreo automático:** perfiles de búsqueda, adaptador Google Places, deduplicación, cron diario.
5. **Fase 5 — Integraciones:** Gmail/Outlook (borradores y envío con aprobación), Google Calendar, resumen diario por email.
6. **Fase 6 — Métricas y cumplimiento:** dashboard, exportaciones, lista de exclusión, baja, derechos RGPD/habeas data.

Entregables en cada fase: código, migraciones, actualización de `README.md` (instalación, variables de entorno, cómo ejecutar el cron en local) y una lista breve de decisiones tomadas y pendientes.

---

## 6. Verificación

Antes de dar por cerrada cada fase:
- Tests unitarios (Vitest) para scoring, deduplicación, generación de tareas de cadencia y lista de exclusión.
- Test end-to-end (Playwright) del flujo: importar CSV → empresa investigada → cadencia asignada → tarea en "Mi día" → marcar resultado → aparece el siguiente paso.
- Ejecutar el cron dos veces seguidas y comprobar que no hay duplicados.
- Comprobar que un contacto en la lista de exclusión no recibe tareas ni emails.
- `npm run lint`, `npm run typecheck` y `npm test` sin errores.
- Informe final: qué funciona, qué queda como stub, qué credenciales hacen falta para activarlo.

---

## Prompt de arranque para pegar en Codex

```
Lee SPEC.md completo. Es la especificación de "try! Comercial", la app de gestión
comercial de try! company. Empieza por la Fase 1 tal como se describe en la sección 5.
Antes de escribir código, devuélveme en un mensaje corto: (1) el stack que vas a usar
si difiere del propuesto y por qué, (2) el esquema Prisma propuesto, (3) las dudas que
bloqueen la fase. Si no hay bloqueos, continúa e implementa la Fase 1 completa,
con tests, seed y README. Al terminar, ejecuta la checklist de verificación de la
sección 6 que aplique a la fase y resume el resultado.
```
