import { productCatalog } from '../products/catalog';

export type SectorPlaybook = { sector: string; vocabulario: string[]; retos: string[]; angulos: Record<string, string> };
function manual(sector: string, vocabulario: string[], retos: string[], proceso: string, trazable = false, agro = false): SectorPlaybook {
  return { sector, vocabulario, retos, angulos: Object.fromEntries(productCatalog.filter(p => p.line !== 'Ganadex' || agro).filter(p => p.line !== 'Athenea' || trazable).map(p => [p.line, ({
    Ganadex: 'Registrar las labores, parcelas y cabezas de ganado en el campo.',
    Athenea: `Relacionar el origen, el lote y las salidas de ${proceso}.`,
    trygestión: `Conectar pedidos, albaranes y facturación de ${proceso}.`,
    'SaaS a medida': `Capturar el trabajo de ${proceso} desde el móvil y vincular horas y costes.`,
    'Soporte técnico': `Mantener disponibles los equipos que usa ${proceso}.`,
    Ciberseguridad: `Proteger accesos, copias y documentos de ${proceso}.`,
    'Sistemas de gestión': `Ordenar responsabilidades y registros de ${proceso}.`,
    'Bots / IA': `Clasificar consultas y documentación repetitiva de ${proceso} con revisión humana.`,
  } as Record<string, string>)[p.line]])) };
}
export const sectorPlaybooks = {
  vino: manual('bodegas y vino', ['lote', 'cuaderno de bodega', 'vendimia', 'depósito', 'DOP', 'embotellado'], ['¿Cómo relacionan la entrada de uva con el lote embotellado?', '¿Dónde registran los movimientos entre depósitos?', '¿Cómo preparan la documentación de una expedición?', '¿Qué cuesta reconstruir el recorrido de un lote?'], 'la bodega', true),
  alimentacion: manual('industria cárnica y alimentaria', ['lote', 'despiece', 'caducidad', 'cámara', 'expedición', 'cadena de frío'], ['¿Cómo relacionan materias primas y lotes de salida?', '¿Cómo gestionan las caducidades en cámara?', '¿Dónde registran las incidencias de producción?', '¿Cómo reconstruyen el recorrido de una expedición?'], 'la planta', true),
  transporte: manual('transporte y logística', ['ruta', 'flota', 'porte', 'albarán', 'camión', 'grúa'], ['¿Cómo reciben los partes de cada ruta?', '¿Dónde relacionan combustible y costes del porte?', '¿Cómo recuperan un albarán firmado?', '¿Cómo coordinan las incidencias de la flota?'], 'las rutas'),
  suministros: manual('suministros y distribución', ['albarán', 'pedido', 'referencia', 'almacén', 'reposición', 'existencias'], ['¿Cómo consultan las existencias al preparar un pedido?', '¿Qué ocurre cuando una referencia se agota?', '¿Cómo relacionan albaranes y facturas?', '¿Dónde revisan las diferencias de inventario?'], 'el almacén', true),
  agro: manual('agro y ganadería', ['parcela', 'campaña', 'cuaderno de campo', 'cabezas de ganado', 'explotación'], ['¿Cómo registran las labores desde la explotación?', '¿Dónde consultan los movimientos del ganado?', '¿Cómo reúnen los costes de cada campaña?', '¿Qué registros siguen pasando del papel al ordenador?'], 'la explotación', true, true),
  construccion: manual('construcción e instalaciones', ['obra', 'parte de trabajo', 'medición', 'cuadrilla', 'material'], ['¿Cómo llegan los partes desde la obra?', '¿Dónde relacionan horas y materiales?', '¿Cómo conocen el coste de cada trabajo?', '¿Cómo preparan la facturación de lo ejecutado?'], 'la obra'),
  industria: manual('industria y metal', ['orden de fabricación', 'taller', 'pieza', 'parte de trabajo', 'material'], ['¿Dónde registran las horas de cada orden?', '¿Cómo conocen el material consumido?', '¿Cómo gestionan los cambios de una pieza?', '¿Cómo pasan del parte de taller a la factura?'], 'el taller', true),
  comercio: manual('comercio minorista', ['tienda', 'ticket', 'reposición', 'caja', 'referencia'], ['¿Cómo coordinan caja y existencias?', '¿Dónde revisan las necesidades de reposición?', '¿Cómo reúnen las ventas de la tienda?', '¿Cómo resuelven una devolución?'], 'la tienda'),
  hosteleria: manual('hostelería y turismo', ['reserva', 'turno', 'ocupación', 'escandallo', 'proveedor'], ['¿Cómo coordinan reservas y turnos?', '¿Dónde revisan los consumos?', '¿Cómo relacionan compras y escandallos?', '¿Qué tareas administrativas quedan al cerrar el día?'], 'el establecimiento'),
  salud: manual('clínicas y salud', ['agenda', 'cita', 'consulta', 'consentimiento', 'acceso'], ['¿Cómo coordinan las agendas?', '¿Cómo gestionan los cambios de cita?', '¿Quién puede acceder a cada documento?', '¿Cómo separan la gestión administrativa de la documentación clínica?'], 'la clínica'),
  servicios: manual('asesorías y servicios profesionales', ['expediente', 'encargo', 'plazo', 'documentación', 'horas'], ['¿Dónde consultan el estado de cada expediente?', '¿Cómo reúnen la documentación pendiente?', '¿Cómo relacionan horas y encargos?', '¿Cómo controlan los plazos del equipo?'], 'los expedientes'),
  general: manual('general', ['pedido', 'parte de trabajo', 'factura', 'coste'], ['¿Qué tarea exige copiar datos entre programas?', '¿Dónde consultan los costes de cada trabajo?', '¿Cómo comparten el estado de los pedidos?', '¿Qué información falta al decidir?'], 'el trabajo diario'),
};
export type Sector = keyof typeof sectorPlaybooks;
const clean = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function detectSector(input: { name?: string | null; sector?: string | null; codes?: string[] }): Sector {
  const text = clean(`${input.name ?? ''} ${input.sector ?? ''}`);
  const rules: [Sector, RegExp][] = [
    ['vino', /bodega|vino|vinic|vitic|\bdop\b/], ['alimentacion', /carnic|aliment|fish|pescad|matadero|embutid/],
    ['transporte', /transport|logistic|portes/], ['suministros', /suministro|distribu|ferreter|almacen/],
    ['agro', /agro|ganad|agric|explotacion/], ['construccion', /constru|instalacion|cristaler|obra|reforma/],
    ['industria', /industr|metal|taller|mecaniz/], ['comercio', /comercio|tienda|minorista/],
    ['hosteleria', /hotel|hostel|turis|restaurante|bar\b/], ['salud', /clinic|salud|dental|sanitari/], ['servicios', /asesor|abogad|consultor|despacho/],
  ];
  const keyword = rules.find(([, pattern]) => pattern.test(text));
  if (keyword) return keyword[0];
  const codes = [...(input.codes ?? []), ...(text.match(/\b\d{2,4}\b/g) ?? [])];
  const prefixes: [Sector, RegExp][] = [['vino', /^110[12]/], ['alimentacion', /^(10|102|103)/], ['agro', /^0[1-3]/], ['transporte', /^(49|50|51|52|53)/], ['suministros', /^46/], ['construccion', /^(41|42|43)/], ['industria', /^(2[0-9]|3[0-3]|45)/], ['comercio', /^47/], ['hosteleria', /^(55|56|79)/], ['salud', /^86/], ['servicios', /^(69|70|71|74)/]];
  return prefixes.find(([, pattern]) => codes.some(code => pattern.test(code)))?.[0] ?? 'general';
}
