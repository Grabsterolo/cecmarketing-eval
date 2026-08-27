// Taxonomía de procedimientos del CEC.
//
// La clasificación NO vive acá: la calcula Postgres en la columna generada
// sofia_conversations.procedure_code (ver la función sofia_procedure_code,
// migración sofia_procedure_code_taxonomy). Este archivo solo pone nombres
// legibles a esos códigos y define cómo se agrupan en el filtro.
//
// Los códigos salieron de analizar las 2.470 variantes que Claude escribió en
// procedure_interest — texto libre — sobre 8.958 conversaciones reales. La
// cobertura medida es 96,4%. Es independiente de las etiquetas de Zenvia a
// propósito: esa lista mezcla procedimiento, temperatura del lead y doctor, y
// se han observado etiquetas mal puestas.

// código → nombre que se muestra en pantalla.
export const PROCEDURE_LABELS = {
  mamario_mia: "MIA Femtech",
  mamario_preserve: "Preservé",
  mamario_aumento_tradicional: "Aumento mamario tradicional",
  mamario_mastopexia: "Mastopexia / levantamiento",
  mamario_reduccion: "Reducción mamaria",
  mamario_reconstruccion: "Reconstrucción mamaria",

  facial_lifting: "Lifting facial",
  facial_blefaroplastia: "Blefaroplastia",
  facial_rinoplastia: "Rinoplastia",
  facial_otoplastia: "Otoplastia",
  facial_bichectomia: "Bichectomía",

  corporal_abdominoplastia: "Abdominoplastia",
  corporal_liposuccion: "Liposucción / lipoescultura",
  corporal_mommy_makeover: "Mommy makeover",
  corporal_braquioplastia: "Braquioplastia / brazos",
  corporal_gluteos: "Glúteos",
  corporal_ginecomastia: "Ginecomastia",
  corporal_remodelacion_costal: "Remodelación costal",
  intima: "Íntima",

  aparato_ultherapy: "Ultherapy",
  aparato_quantumrf_papada: "QuantumRF / papada",
  aparato_trilipo: "Trilipo",
  aparato_tite_morpheus: "BodyTite / FaceTite / Morpheus",
  aparato_oxygeneo: "OxyGeneo",
  aparato_laser: "Láser",
  aparato_reduccion_grasa: "Reducción de grasa no quirúrgica",

  inyect_toxina: "Toxina botulínica",
  inyect_radiesse: "Radiesse",
  inyect_harmonyca: "HarmonyCa",
  inyect_acido_hialuronico: "Ácido hialurónico / rellenos",
  inyect_bioestimuladores: "Bioestimuladores",
  inyect_armonizacion_facial: "Armonización facial",

  estetica_facial: "Facial (limpieza, peeling, manchas)",
  estetica_depilacion: "Depilación",
  estetica_postoperatorio: "Post-operatorio",
  estetica_piel_flacidez: "Piel / flacidez",

  no_paciente_laboral: "Consulta laboral (no es paciente)",
  promociones: "Promociones",
  generico_sin_procedimiento: "Sin procedimiento definido",
  generico_solo_precio: "Solo preguntó precio",
  generico_logistica: "Logística (ubicación, cita)",
  generico_proceso: "Sobre el proceso",
  sin_clasificar: "Sin clasificar",
};

export function procedureLabel(code) {
  return PROCEDURE_LABELS[code] || code || "Sin procedimiento";
}

// Familias del filtro. Cada una se puede elegir entera, y adentro están los
// procedimientos sueltos — MIA, Preservé, aumento tradicional y mastopexia
// quedan separados a propósito: son técnicas distintas con perfiles de
// escalación muy distintos (mastopexia escala al 51%, Preservé al 28%).
export const PROCEDURE_FAMILIES = [
  {
    value: "fam_mamario",
    label: "Mamario (todo)",
    codes: ["mamario_mia", "mamario_preserve", "mamario_aumento_tradicional", "mamario_mastopexia", "mamario_reduccion", "mamario_reconstruccion"],
  },
  {
    value: "fam_facial_qx",
    label: "Facial quirúrgico (todo)",
    codes: ["facial_lifting", "facial_blefaroplastia", "facial_rinoplastia", "facial_otoplastia", "facial_bichectomia"],
  },
  {
    value: "fam_corporal_qx",
    label: "Corporal quirúrgico (todo)",
    codes: ["corporal_abdominoplastia", "corporal_liposuccion", "corporal_mommy_makeover", "corporal_braquioplastia", "corporal_gluteos", "corporal_ginecomastia", "corporal_remodelacion_costal", "intima"],
  },
  {
    value: "fam_aparato",
    label: "Aparatología (todo)",
    codes: ["aparato_ultherapy", "aparato_quantumrf_papada", "aparato_trilipo", "aparato_tite_morpheus", "aparato_oxygeneo", "aparato_laser", "aparato_reduccion_grasa"],
  },
  {
    value: "fam_inyectables",
    label: "Inyectables (todo)",
    codes: ["inyect_toxina", "inyect_radiesse", "inyect_harmonyca", "inyect_acido_hialuronico", "inyect_bioestimuladores", "inyect_armonizacion_facial"],
  },
  {
    value: "fam_estetica",
    label: "Estética (todo)",
    codes: ["estetica_facial", "estetica_depilacion", "estetica_postoperatorio", "estetica_piel_flacidez"],
  },
  {
    value: "fam_sin_procedimiento",
    label: "Sin procedimiento / otros",
    codes: ["generico_sin_procedimiento", "generico_solo_precio", "generico_logistica", "generico_proceso", "promociones", "no_paciente_laboral", "sin_clasificar"],
  },
];

// Opciones del <select>, agrupadas: primero la familia entera, después cada
// procedimiento por separado.
export const PROCEDURE_OPTIONS = [
  { value: "todos", label: "Procedimiento: todos" },
  ...PROCEDURE_FAMILIES.flatMap((fam) => [
    { value: fam.value, label: fam.label, group: fam.label },
    ...fam.codes.map((code) => ({
      value: code,
      label: `   ${procedureLabel(code)}`,
      group: fam.label,
    })),
  ]),
];

// Códigos que abarca una opción del filtro: una familia entera, un código
// suelto, o null para "todos".
export function codesFor(value) {
  if (!value || value === "todos") return null;
  const fam = PROCEDURE_FAMILIES.find((f) => f.value === value);
  return fam ? fam.codes : [value];
}

// Predicado para las secciones que filtran en memoria.
export function matchesProcedure(procedureCode, value) {
  const codes = codesFor(value);
  if (!codes) return true;
  return codes.includes(procedureCode);
}

// Claude escribe procedure_interest sin criterio fijo de mayúsculas, así que
// en las listas convivían "Aumento mamario" y "abdominoplastia con lipo 360".
// Solo se levanta la primera letra: un capitalize completo rompería nombres
// de marca como "MIA Femtech", "QuantumRF" o "Ultherapy PRIME".
export function formatProcedure(procedureInterest) {
  const s = (procedureInterest || "").trim();
  if (!s) return "";
  return s[0].toLocaleUpperCase("es") + s.slice(1);
}
