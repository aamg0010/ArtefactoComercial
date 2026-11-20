# Prompt de arranque para Codex

Copia este bloque en Codex con el repositorio abierto (con `SPEC.md` y la carpeta `data/` en la raíz):

```
Lee SPEC.md completo, incluida la sección 7, y revisa los archivos de data/.
Es la especificación de "try! Comercial", la app de gestión comercial de try! company,
y data/ contiene la primera prospección real: 56 empresas de Aragón y los guiones de
las 5 de prioridad A. Esos datos son la fuente de verdad del seed: no inventes ni
completes datos de empresas.

Empieza por la Fase 1 de la sección 5. Antes de escribir código, devuélveme en un
mensaje corto:
(1) el stack que vas a usar si difiere del propuesto y por qué,
(2) el esquema Prisma propuesto, mostrando cómo encajan prospectos.json y guiones.json,
(3) las dudas que bloqueen la fase.

Si no hay bloqueos, implementa la Fase 1 completa: seed idempotente con data/,
importación CSV (prueba con data/prospectos.csv), script import:sheet, tests y README.
Al terminar, ejecuta la checklist de la sección 6 que aplique y dime cuántas empresas
y guiones quedan cargados.
```

Cuando termine la Fase 1, sigue con:

```
Continúa con la Fase 2. El criterio de aceptación es que "Mi día" del lunes
23/11/2026 muestre las tareas de La Calandina y de la Cooperativa Ganadera de Caspe
con su guion de llamada y su email listos, y que al marcar un resultado se cree el
siguiente paso de la cadencia.
```
