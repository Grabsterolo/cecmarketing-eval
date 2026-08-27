// Agrupaciones de procedure_interest, compartidas por Leads Potenciales,
// Métricas Sofía y Seguimiento.
//
// Claude escribe procedure_interest en texto libre, así que el mismo
// procedimiento aparece con mayúsculas, acentos y orden de palabras distintos
// ("MIA Femtech", "Aumento de senos Mia", "Mia® Femtech"). Los fragmentos de
// cada grupo salieron de los valores reales de la tabla, no de una lista
// teórica, y se verificó contra la base que no arrastren casos ajenos.
//
// Los grupos NO son mutuamente excluyentes a propósito: MIA Femtech es un
// procedimiento mamario, así que esas conversaciones caen tanto en "MIA
// Femtech" como en "Aumento mamario". Es intencional — permite ver el total
// mamario o aislar MIA, según lo que se quiera medir.
export const PROCEDURE_GROUPS = [
  { value: "todos", label: "Procedimiento: todos", patterns: null },
  { value: "mia", label: "MIA Femtech", patterns: ["mia", "femtech"] },
  {
    value: "mamario",
    label: "Aumento mamario (todo)",
    // "mia"/"femtech" van incluidos porque MIA Femtech es una técnica de
    // aumento mamario: sin ellos, un valor como "MIA Femtech" a secas se
    // quedaba fuera de un grupo que dice "todo".
    patterns: ["aumento mamario", "aumento de senos", "aumento senos", "preservé", "preserve", "mastopexia", "armonización mamaria", "mia", "femtech"],
  },
  { value: "abdominoplastia", label: "Abdominoplastia", patterns: ["abdominoplastia"] },
  { value: "rinoplastia", label: "Rinoplastia", patterns: ["rinoplastia"] },
  { value: "facial_qx", label: "Lifting facial / blefaroplastia", patterns: ["lifting facial", "blefaroplastia"] },
  { value: "ultherapy", label: "Ultherapy", patterns: ["ultherapy"] },
  {
    value: "inyectables",
    label: "Inyectables",
    patterns: ["botox", "toxina", "hialurónico", "hialuronico", "radiesse", "harmonyca"],
  },
  {
    value: "corporal_no_qx",
    label: "Corporal no quirúrgico",
    patterns: ["trilipo", "quantumrf", "lipopapada", "oxygeneo", "oxígeno", "liposucción papada"],
  },
  {
    value: "sin_especificar",
    label: "Sin especificar / general",
    patterns: ["información general", "informacion general", "no especificado", "sin especificar", "consulta general", "información de precios", "consulta de precios"],
  },
];

function groupFor(value) {
  return PROCEDURE_GROUPS.find((g) => g.value === value);
}

// Predicado en JS, para las secciones que ya tienen las filas en memoria y
// filtran del lado del cliente (Métricas Sofía).
export function matchesProcedure(procedureInterest, groupValue) {
  const group = groupFor(groupValue);
  if (!group?.patterns) return true;
  const haystack = (procedureInterest || "").toLowerCase();
  if (!haystack) return false;
  return group.patterns.some((p) => haystack.includes(p));
}

// Cadena para el .or() de PostgREST, para las secciones que filtran contra
// Supabase (Leads Potenciales, Seguimiento). Devuelve null si el grupo no
// filtra nada, para que quien llame se salte el .or() por completo.
export function procedureOrFilter(groupValue) {
  const group = groupFor(groupValue);
  if (!group?.patterns) return null;
  // ilike con * a ambos lados = "contiene", insensible a mayúsculas.
  return group.patterns.map((p) => `procedure_interest.ilike.*${p}*`).join(",");
}
