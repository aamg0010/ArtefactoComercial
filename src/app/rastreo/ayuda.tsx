import type { SourceRun } from '@prisma/client';

/** Palabras clave que OpenStreetMap reconoce como tipo de negocio (ver osmTagFilters). */
const reconocidas = ['bodega / vino', 'almazara / aceite', 'granja / ganadería / porcino / ovino', 'gestoría / asesoría', 'taller', 'limpieza', 'distribución', 'cooperativa / fruta / jamón / alimentación'];

export function ConsejosPerfil() {
  return <details className="rounded-xl border border-try-100 bg-try-50/60 p-4" open>
    <summary className="cursor-pointer font-display font-semibold text-try-900">💡 Consejos para crear perfiles y que las búsquedas sean más certeras</summary>
    <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
      <li><b>Un perfil = un sector + un producto.</b> Mejor «Bodegas Matarraña → Athenea» que un perfil que lo mezcle todo. Así el guion y la puntuación encajan mejor.</li>
      <li><b>Municipios con su nombre oficial</b>, como aparece en el mapa y con tildes: <i>Alcañiz; Andorra; La Puebla de Híjar</i>. Cada municipio se busca por separado y una ejecución hace como máximo 20 búsquedas (municipios × provincias): mejor pocos municipios por perfil.</li>
      <li><b>Provincia oficial</b> (<i>Teruel</i>, <i>Zaragoza</i>). Si todos los municipios son de la misma provincia, pon solo esa: cada provincia de más multiplica las búsquedas.</li>
      <li><b>Comarcas</b>: solo sirven para clasificar las empresas, no filtran la búsqueda. Déjalo vacío o pon la comarca real; no escribas «Todas».</li>
      <li><b>Sector / palabras clave concretas.</b> Estas OpenStreetMap las entiende como tipo de negocio: {reconocidas.join(' · ')}. Además, cada palabra se busca en el nombre del negocio (p. ej. <i>cárnica</i>, <i>transportes</i>, <i>piensos</i>). Evita palabras genéricas como «Industrias» o «Empresas»: traen cualquier comercio y llenan la lista de ruido.</li>
      <li><b>Máximo de resultados</b>: empieza con 10–20, revisa la calidad y amplía si merece la pena.</li>
      <li><b>Fuentes</b>: OpenStreetMap es gratuito y público, pero a veces le faltan web o teléfono. Google Places es más completo (necesita clave) y sus empresas quedan pendientes de aceptar. CSV, si tienes un listado propio.</li>
      <li><b>eInforma</b> busca cada palabra clave en la <b>razón social</b> de todas las empresas de España y se queda con las de tus provincias (no filtra por municipio ni por CNAE). Funciona mejor con palabras que suelen estar en el nombre: <i>almazara, cooperativa, bodega, cárnica, transportes, construcciones</i>. Las empresas entran con el municipio «por verificar»; búscalas también en Google o investígalas para completarlas. Buscar no gasta saldo de eInforma.</li>
      <li><b>RUES (Colombia)</b> usa los datos abiertos de las cámaras de comercio: sociedades y entidades activas que han renovado la matrícula este año o el anterior (nunca personas naturales). En <i>Provincias</i> pon el <b>departamento</b> (<i>Antioquia; Córdoba</i>) o la ciudad sede de la cámara (<i>Montería</i>): el RUES abierto no trae municipio, así que las empresas entran con el municipio «por verificar». Busca por <b>código CIIU</b> (p. ej. <i>0141</i> ganado bovino, <i>0144</i> porcino, <i>0145</i> avícola, <i>1011</i> cárnicos, <i>1040</i> lácteos) o por palabras de la razón social (<i>ganadera, agropecuaria, hacienda</i>). Cada ejecución trae empresas nuevas, sin repetir las que ya trajo.</li>
      <li><b>Códigos CNAE / CIIU</b>: en España todavía no filtran la búsqueda (úsalos como referencia); en Colombia los usa el RUES. Con 2 dígitos abarcas todo el grupo (<i>01</i> = agricultura y ganadería).</li>
      <li><b>Si no sale nada</b>: revisa la ortografía del municipio y la provincia, prueba una palabra clave más concreta y, si el resumen dice que OpenStreetMap está saturado, vuelve a intentarlo en unos minutos.</li>
    </ol>
  </details>;
}

const explicaciones: [RegExp, string][] = [
  [/^OVERPASS_(HTTP_(429|50\d)|NETWORK_ERROR)$/, 'OpenStreetMap está saturado o no responde (se probaron varios servidores). Vuelve a ejecutar en unos minutos.'],
  [/^OVERPASS_RESPONSE_INVALID$/, 'OpenStreetMap devolvió una respuesta no válida. Revisa el municipio y la provincia y vuelve a intentarlo.'],
  [/^OVERPASS_HTTP_/, 'OpenStreetMap rechazó la búsqueda. Revisa que los nombres no tengan caracteres raros.'],
  [/^GOOGLE_PLACES_NOT_CONFIGURED$/, 'Google Places no está configurado (falta la clave), así que no se buscó en Google. Desmarca Google en el perfil o configura la clave.'],
  [/^EINFORMA_NOT_CONFIGURED$/, 'eInforma no tiene credenciales configuradas, así que no se buscó allí.'],
  [/^EINFORMA_(TOKEN_HTTP_(400|401|403)|HTTP_(401|403))$/, 'eInforma rechazó las credenciales (usuario o clave API). Revísalas en tu zona privada de eInforma.'],
  [/^EINFORMA_ONLY_SPAIN$/, 'eInforma solo tiene empresas de España: desmárcalo en perfiles de Colombia.'],
  [/^EINFORMA_(NETWORK_ERROR|HTTP_(429|50\d))$/, 'eInforma no responde o está saturado. Vuelve a ejecutar en unos minutos.'],
  [/^EINFORMA_/, 'eInforma devolvió una respuesta inesperada. Inténtalo más tarde.'],
  [/^RUES_ONLY_COLOMBIA$/, 'El RUES solo tiene empresas de Colombia: desmárcalo en perfiles de España.'],
  [/^RUES_NO_CHAMBER$/, 'El RUES no reconoce ningún departamento del perfil. En Provincias escribe el departamento (p. ej. Antioquia; Córdoba) o la ciudad sede de la cámara de comercio (p. ej. Montería).'],
  [/^RUES_(NETWORK_ERROR|HTTP_(429|50\d))$/, 'Datos abiertos de Colombia (RUES) no responde o está saturado. Vuelve a ejecutar en unos minutos.'],
  [/^RUES_/, 'El RUES devolvió una respuesta inesperada. Inténtalo más tarde.'],
  [/^SOURCE_NOT_IMPLEMENTED:(.+)$/, 'Una de las fuentes marcadas todavía no está disponible. Desmárcala en el perfil.'],
  [/^GOOGLE_LIVE_DEDUP_UNAVAILABLE$/, 'No se pudo comprobar duplicados contra Google; las empresas nuevas se revisarán igualmente.'],
];
export function explicarError(code: string) { return explicaciones.find(([pattern]) => pattern.test(code))?.[1] ?? `Error técnico: ${code}`; }

export function ResumenEjecucion({ runs }: { runs: (SourceRun & { profile: { name: string } })[] }) {
  return <section role="status" aria-label="Resultado de la búsqueda" className="card border-try-200 p-4">
    <h2 className="text-lg font-semibold">Resultado de la búsqueda</h2>
    {runs.map(run => {
      const errores = [...new Set((run.errorCodes as string[] | null) ?? [])];
      return <div key={run.id} className="mt-2">
        <p><b>{run.profile.name}</b>: {run.candidates} encontradas · <b>{run.created} nuevas</b> · {run.duplicates} ya estaban · {run.suppressed} dadas de baja.</p>
        {run.created > 0 && <p className="text-sm">Las nuevas aparecen abajo, en «Detectadas hoy».</p>}
        {!run.candidates && !errores.length && <p className="text-sm">No se encontró ninguna empresa con estos criterios. Revisa los consejos: nombres oficiales de municipio y provincia, y palabras clave más concretas.</p>}
        {errores.length > 0 && <ul className="mt-1 list-disc pl-5 text-sm text-amber-800">{errores.map(code => <li key={code}>{explicarError(code)}</li>)}</ul>}
      </div>;
    })}
  </section>;
}
