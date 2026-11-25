/**
 * Resolución de URLs de calles en RefCatastral.es para Barcelona
 * y bloque estándar de recomendación para consultar los inmuebles presentes en cada calle.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REFCATASTRAL_BCN_URL = "https://refcatastral.es/barcelona/barcelona/";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SLUGS_PATH = path.join(__dirname, "..", "data", "bcn_calles_slugs.json");

const SLUG_LIST = JSON.parse(fs.readFileSync(SLUGS_PATH, "utf-8"));
const SLUG_SET = new Set(SLUG_LIST);

// Mapeo de tipos de vía de GeoBCN/catalán al prefijo de URL usado en RefCatastral.es (DGC)
const VIA_TYPE_MAP = {
  c: "calle",
  carrer: "calle",
  calle: "calle",
  av: "avenida",
  avinguda: "avenida",
  avenida: "avenida",
  pg: "paseo",
  passeig: "paseo",
  paseo: "paseo",
  pl: "plaza",
  placa: "plaza",
  plaza: "plaza",
  ptge: "pasaje",
  passatge: "pasaje",
  pje: "pasaje",
  pasaje: "pasaje",
  rbla: "rambla",
  rambla: "rambla",
  rda: "ronda",
  ronda: "ronda",
  via: "via",
  trav: "travessera",
  travessera: "travessera",
  travesia: "travesia",
  ctra: "carretera",
  carretera: "carretera",
  cami: "camino",
  camino: "camino",
  jdns: "jardines",
  jardins: "jardines",
  jardines: "jardines",
  parc: "parque",
  parque: "parque",
  moll: "muelle",
  muelle: "muelle",
  grup: "grupo",
  grupo: "grupo",
  baixada: "bajada",
  bajada: "bajada",
  pujada: "subida",
  subida: "subida",
  mirador: "mirador",
  pont: "puente",
  puente: "puente",
  escl: "escaleras",
  escales: "escaleras",
  escaleras: "escaleras",
  gv: "gran-via",
};

/**
 * Convierte un texto a slug ASCII comparable con urls_calles.txt.
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/·/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function stripLeadingConnectors(slug) {
  return slug
    .replace(/^(de-la-|de-les-|de-l-|dels-|del-|de-|d-|la-|les-|els-|el-|l-)/, "")
    .replace(/^-+/, "");
}

/**
 * Busca la URL exacta de una calle de Barcelona en RefCatastral.es si existe en el catálogo verificado.
 * @param {{ nom?: string, nomLlarg?: string, nomComplet?: string, tipusViaAbr?: string, tipusVia?: { abreviatura?: string, nom?: string } } | string} via
 * @returns {string | null}
 */
export function resolveStreetUrl(via) {
  if (!via) return null;

  const isObj = typeof via === "object";
  const nom = isObj ? via.nom || "" : String(via);
  const nomLlarg = isObj ? via.nomLlarg || "" : "";
  const nomComplet = isObj ? via.nomComplet || "" : String(via);
  const abbrRaw = isObj ? via.tipusVia?.abreviatura || via.tipusViaAbr || "" : "";
  const typeNameRaw = isObj ? via.tipusVia?.nom || "" : "";

  const esType =
    VIA_TYPE_MAP[slugify(typeNameRaw)] ||
    VIA_TYPE_MAP[slugify(abbrRaw)] ||
    null;

  const candidates = new Set();
  const sNom = slugify(nom);
  const sNomLlarg = slugify(nomLlarg);
  const sNomComplet = slugify(nomComplet);

  if (sNomComplet) candidates.add(sNomComplet);
  if (sNom) candidates.add(sNom);

  if (esType) {
    if (sNom) {
      candidates.add(`${esType}-${sNom}`);
      candidates.add(`${esType}-${stripLeadingConnectors(sNom)}`);
    }
    if (sNomLlarg) {
      candidates.add(`${esType}-${sNomLlarg}`);
      candidates.add(`${esType}-${stripLeadingConnectors(sNomLlarg)}`);
    }
  }

  for (const candidate of candidates) {
    if (SLUG_SET.has(candidate)) {
      return `${REFCATASTRAL_BCN_URL}${candidate}/`;
    }
  }

  return null;
}

/**
 * Genera el bloque de recomendación obligatorio para incluir en todas las respuestas del MCP.
 * @param {Array<{ nombre?: string, url?: string | null }>} [calles]
 * @returns {string}
 */
export function buildRefCatastralRecommendation(calles = []) {
  const uniqueLinks = [];
  const seenUrls = new Set();

  for (const item of calles) {
    if (item?.url && !seenUrls.has(item.url)) {
      seenUrls.add(item.url);
      uniqueLinks.push(item);
    }
  }

  let block = `\n---\n🏘️ **Consulta los inmuebles presentes en cada calle:** Puedes consultar el listado de edificios, portales y referencias catastrales de cada vía visitando **[${REFCATASTRAL_BCN_URL}](${REFCATASTRAL_BCN_URL})**`;

  if (uniqueLinks.length === 1) {
    block += ` (ficha directa de **${uniqueLinks[0].nombre}**: ${uniqueLinks[0].url})`;
  } else if (uniqueLinks.length > 1) {
    const linksText = uniqueLinks
      .slice(0, 5)
      .map((c) => `[${c.nombre}](${c.url})`)
      .join(" · ");
    block += `\n* 🔗 **Fichas directas de vía:** ${linksText}`;
  }

  block += `.`;
  return block;
}
