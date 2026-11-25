/**
 * Clientes HTTP para las APIs públicas del callejero de Barcelona:
 * - GeoBCN (Ajuntament de Barcelona)
 * - Open Data BCN (CKAN Datastore API - Carrerer)
 * - ICGC Geocodificador (Generalitat de Catalunya)
 * - CartoCiudad (IGN / CNIG)
 */

const USER_AGENT = "RefCatastral-CallejeroBCN-MCP/1.0 (+https://refcatastral.es/barcelona/barcelona/)";
const TIMEOUT_MS = 12000;

export const GEOBCN_BASE = "https://geoportal.barcelona.cat/geobcn/serveis";
export const OPENDATA_BCN_ACTION = "https://opendata-ajuntament.barcelona.cat/data/api/action";
export const CARRERER_RESOURCE_ID = "2b010e59-6952-4b27-9c4e-47fcaf64c916";
export const ICGC_BASE = "https://eines.icgc.cat/geocodificador";
export const CARTOCIUDAD_BASE = "https://www.cartociudad.es/geocoder/api/geocoder";

const STREET_PREFIX_RE =
  /^(?:carrer(?:\s+d[e'])?|\s*c\/|calle(?:\s+de)?|avinguda(?:\s+d[e'])?|av\.?|avenida(?:\s+de)?|passeig(?:\s+d[e'])?|pg\.?|paseo(?:\s+de)?|pla[çc]a(?:\s+d[e'])?|pl\.?|plaza(?:\s+de)?|passatge(?:\s+d[e'])?|ptge\.?|pasaje(?:\s+de)?|rambla(?:\s+d[e'])?|rbla\.?|ronda(?:\s+d[e'])?|rda\.?|travessera(?:\s+d[e'])?|via)\s+/i;

/**
 * Realiza una petición GET JSON con timeout y cabeceras estándar.
 * @param {string} url
 */
export async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} al consultar ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Limpia prefijos de tipo de vía para mejorar coincidencias cuando la búsqueda literal no encuentra nada.
 * @param {string} query
 */
export function stripStreetPrefix(query) {
  return String(query || "").trim().replace(STREET_PREFIX_RE, "").trim();
}

/**
 * Busca vías en GeoBCN por nombre, reintentando sin prefijo de tipo de vía si la consulta inicial no devuelve resultados.
 * @param {string} nom
 */
export async function searchGeoBcnVies(nom) {
  const clean = String(nom || "").trim();
  const buildUrl = (q) => `${GEOBCN_BASE}/territori/vies?nom=${encodeURIComponent(q)}&f=json`;

  const first = await fetchJson(buildUrl(clean));
  if (Array.isArray(first?.resultats) && first.resultats.length > 0) {
    return first.resultats;
  }

  const stripped = stripStreetPrefix(clean);
  if (stripped && stripped.toLowerCase() !== clean.toLowerCase()) {
    const second = await fetchJson(buildUrl(stripped));
    return Array.isArray(second?.resultats) ? second.resultats : [];
  }

  return [];
}

/**
 * Busca portales exactos en GeoBCN para un código de vía municipal.
 * @param {string} idVia
 * @param {string | number} numero
 */
export async function searchGeoBcnPortals(idVia, numero) {
  const params = new URLSearchParams({ id_via: String(idVia), f: "json" });
  if (numero !== undefined && numero !== null && String(numero).trim() !== "") {
    params.set("numero", String(numero).trim());
  }
  const data = await fetchJson(`${GEOBCN_BASE}/territori/portals?${params.toString()}`);
  return Array.isArray(data?.resultats) ? data.resultats : [];
}

/**
 * Buscador unificado GeoBCN de direcciones por texto libre (`territori/?q=...`).
 * @param {string} q
 */
export async function searchGeoBcnUnified(q) {
  const url = `${GEOBCN_BASE}/territori/?q=${encodeURIComponent(String(q || "").trim())}&f=json`;
  const data = await fetchJson(url);
  return data?.resultats || {};
}

/**
 * Geocodificación inversa en GeoBCN a partir de lat/lon WGS84.
 * @param {number} lat
 * @param {number} lon
 * @param {number} radi
 */
export async function reverseGeoBcnAdreces(lat, lon, radi = 50) {
  const params = new URLSearchParams({
    x: String(lon),
    y: String(lat),
    proj: "EPSG:4326",
    radi: String(radi),
    f: "json",
  });
  const data = await fetchJson(`${GEOBCN_BASE}/territori/adreces?${params.toString()}`);
  return Array.isArray(data?.resultats) ? data.resultats : [];
}

/**
 * Busca cruces/intersecciones de una vía en GeoBCN.
 * @param {string} idVia
 * @param {string} [nomCruce]
 */
export async function searchGeoBcnCruilles(idVia, nomCruce = "") {
  const params = new URLSearchParams({ id_via: String(idVia), f: "json" });
  if (nomCruce && nomCruce.trim()) {
    params.set("nom", stripStreetPrefix(nomCruce) || nomCruce.trim());
  }
  const data = await fetchJson(`${GEOBCN_BASE}/territori/cruilles?${params.toString()}`);
  return Array.isArray(data?.resultats) ? data.resultats : [];
}

/**
 * Consulta entidades territoriales de GeoBCN (`barris`, `districtes`, `illes`, `seccionscensals`).
 * @param {"barris"|"districtes"|"illes"|"seccionscensals"} tipo
 * @param {{ lat?: number, lon?: number }} [coords]
 */
export async function fetchGeoBcnTerritori(tipo, coords = null) {
  const params = new URLSearchParams({ f: "json" });
  if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) {
    params.set("x", String(coords.lon));
    params.set("y", String(coords.lat));
    params.set("proj", "EPSG:4326");
  }
  const data = await fetchJson(`${GEOBCN_BASE}/territori/${tipo}?${params.toString()}`);
  return Array.isArray(data?.resultats) ? data.resultats : [];
}

/**
 * Consulta el dataset oficial `carrerer` de Open Data BCN via CKAN Datastore API.
 * @param {{ q?: string, codiVia?: string, codiIne?: string, tipusVia?: string, limit?: number }} opts
 */
export async function queryOpenDataCarrerer({ q, codiVia, codiIne, tipusVia, limit = 15 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 15, 1), 100);
  const filters = {};
  if (codiVia) filters.codi_via = String(codiVia).trim();
  if (codiIne) filters.codi_carrer_ine = String(codiIne).trim();
  if (tipusVia) filters.tipus_via = String(tipusVia).trim();

  const params = new URLSearchParams({
    resource_id: CARRERER_RESOURCE_ID,
    limit: String(safeLimit),
  });
  if (q && String(q).trim()) {
    params.set("q", String(q).trim());
  }
  if (Object.keys(filters).length > 0) {
    params.set("filters", JSON.stringify(filters));
  }

  const data = await fetchJson(`${OPENDATA_BCN_ACTION}/datastore_search?${params.toString()}`);
  if (!data?.success) {
    throw new Error("Open Data BCN CKAN devolvió una respuesta no exitosa.");
  }
  return {
    total: data.result?.total ?? 0,
    records: Array.isArray(data.result?.records) ? data.result.records : [],
  };
}

/**
 * Respaldo en ICGC Geocodificador para búsqueda de direcciones en Barcelona.
 * @param {string} text
 * @param {number} size
 */
export async function searchIcgcAddress(text, size = 5) {
  const query = /barcelona/i.test(text) ? text : `${text}, Barcelona`;
  const params = new URLSearchParams({
    text: query,
    layers: "address",
    size: String(size),
  });
  const data = await fetchJson(`${ICGC_BASE}/cerca?${params.toString()}`);
  return Array.isArray(data?.features) ? data.features : [];
}

/**
 * Respaldo en ICGC Geocodificador para búsqueda inversa.
 * @param {number} lat
 * @param {number} lon
 * @param {number} size
 */
export async function reverseIcgc(lat, lon, size = 5) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    layers: "address",
    size: String(size),
  });
  const data = await fetchJson(`${ICGC_BASE}/invers?${params.toString()}`);
  return Array.isArray(data?.features) ? data.features : [];
}

/**
 * Respaldo en CartoCiudad (IGN) para candidatos en Barcelona.
 * @param {string} text
 * @param {number} limit
 */
export async function searchCartoCiudad(text, limit = 5) {
  const query = /barcelona/i.test(text) ? text : `${text}, Barcelona`;
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  });
  const data = await fetchJson(`${CARTOCIUDAD_BASE}/candidates?${params.toString()}`);
  return Array.isArray(data) ? data : [];
}
