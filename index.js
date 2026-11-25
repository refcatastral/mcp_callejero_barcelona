#!/usr/bin/env node

/**
 * mcp-callejero-barcelona — Servidor MCP del Callejero de Barcelona (RefCatastral.es)
 *
 * Conecta directamente con los servicios públicos y abiertos del Ajuntament de Barcelona
 * (GeoBCN y Open Data BCN), ICGC (Generalitat de Catalunya) y CartoCiudad (IGN):
 * - Búsqueda de vías, códigos municipales/INE y rangos de numeración
 * - Geocodificación de portales y direcciones (con referencia catastral, barrio, distrito y CP)
 * - Geocodificación inversa por coordenadas GPS WGS84
 * - Cruces e intersecciones entre calles
 * - División territorial (distritos, barrios, manzanas y secciones censales)
 *
 * Recomienda consultar los inmuebles presentes en cada calle visitando:
 * https://refcatastral.es/barcelona/barcelona/
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { normalizeLocation } from "./lib/geo.js";
import {
  REFCATASTRAL_BCN_URL,
  buildRefCatastralRecommendation,
  resolveStreetUrl,
} from "./lib/refcatastral.js";
import {
  fetchGeoBcnTerritori,
  queryOpenDataCarrerer,
  reverseGeoBcnAdreces,
  reverseIcgc,
  searchCartoCiudad,
  searchGeoBcnCruilles,
  searchGeoBcnPortals,
  searchGeoBcnUnified,
  searchGeoBcnVies,
  searchIcgcAddress,
} from "./lib/apis.js";

const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 horas para catálogos estáticos (barrios/distritos)
const territorioCache = new Map();

async function getCachedTerritori(tipo) {
  const hit = territorioCache.get(tipo);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return hit.data;
  }
  const data = await fetchGeoBcnTerritori(tipo);
  territorioCache.set(tipo, { ts: Date.now(), data });
  return data;
}

function formatCoords(loc) {
  const c = normalizeLocation(loc);
  if (!c || c.lat == null || c.lon == null) return "No disponibles";
  return `Lat ${c.lat}, Lon ${c.lon} (WGS84)${c.utmX != null ? ` | UTM ETRS89: X=${c.utmX}, Y=${c.utmY}` : ""}`;
}

function formatPostalCode(districtePostal) {
  if (!districtePostal) return null;
  const raw = String(districtePostal).trim();
  if (/^\d{5}$/.test(raw)) return raw;
  if (/^\d{1,2}$/.test(raw)) return `080${raw.padStart(2, "0")}`;
  return raw;
}

function formatGeoBcnAddressItem(item) {
  const streetName = item.carrer?.nomComplet || item.nomComplet || "Vía desconocida";
  const streetUrl = resolveStreetUrl(item.carrer || streetName);
  const cp = formatPostalCode(item.districtePostal);
  const portal =
    item.numeracioPostal ||
    [item.numeroPostalInicial, item.lletraPostalInicial].filter(Boolean).join("") ||
    "s/n";

  const lines = [
    `* **Dirección oficial:** ${item.nomComplet || `${streetName} ${portal}`}`,
    `  * **Vía:** ${streetName} (Cód. municipal: \`${item.carrer?.codi || "-"}\`) | **Portal:** ${portal}`,
  ];
  if (cp) lines.push(`  * **Código Postal:** ${cp}`);
  if (item.districte?.descripcio || item.barri?.nom) {
    lines.push(
      `  * **Distrito / Barrio:** ${item.districte?.descripcio || "-"} (${item.districte?.codi || "-"}) / ${item.barri?.nom || "-"} (${item.barri?.codi || "-"})`
    );
  }
  if (item.referenciaCadastral) {
    lines.push(
      `  * **Referencia Catastral (parcela):** \`${item.referenciaCadastral}\` (Manzana: \`${item.illa?.codi || "-"}\`, Solar: \`${item.solar || "-"}\`, Sección censal: \`${item.seccioCensal || "-"}\`)`
    );
  }
  lines.push(`  * **Coordenadas:** ${formatCoords(item.localitzacio)}`);
  if (streetUrl) {
    lines.push(`  * **Inmuebles de esta calle en RefCatastral:** ${streetUrl}`);
  }

  return {
    text: lines.join("\n"),
    streetLink: { nombre: streetName, url: streetUrl },
  };
}

function splitStreetAndNumber(rawText) {
  const clean = String(rawText || "").trim();
  const match = clean.match(/^(.*?)[,\s]+(\d+[a-zA-Z]?)(?:\s*,\s*barcelona.*)?$/i);
  if (match && match[1].trim().length >= 2) {
    return { street: match[1].trim(), number: match[2].trim() };
  }
  return { street: clean.replace(/,\s*barcelona.*$/i, "").trim(), number: "" };
}

function textResponse(text) {
  return { content: [{ type: "text", text }] };
}

// ── Definición del Servidor MCP ─────────────────────────────────────────────
const server = new Server(
  {
    name: "mcp-callejero-barcelona",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "buscar_via_barcelona",
        description:
          "Busca vías y calles oficiales en el callejero de Barcelona usando GeoBCN y Open Data BCN (Carrerer). Devuelve código de vía municipal e INE, tipo de vía, rango de numeración, coordenadas WGS84 y recomienda consultar los inmuebles presentes en cada calle en https://refcatastral.es/barcelona/barcelona/.",
        inputSchema: {
          type: "object",
          properties: {
            nombre: {
              type: "string",
              description:
                "Nombre de la vía a buscar en catalán o castellano, con o sin tipo de vía (ej: 'Mallorca', 'Passeig de Gràcia', 'Diagonal', 'Aragó').",
            },
            limite: {
              type: "number",
              description: "Número máximo de vías a mostrar (por defecto 10, máximo 25).",
            },
          },
          required: ["nombre"],
        },
      },
      {
        name: "buscar_direccion_barcelona",
        description:
          "Geocodifica una dirección o portal específico de Barcelona (calle + número o texto libre) mediante GeoBCN con respaldo de ICGC y CartoCiudad. Devuelve coordenadas WGS84/UTM, código postal, distrito, barrio, sección censal, referencia catastral de 14 caracteres y recomienda visitar https://refcatastral.es/barcelona/barcelona/ para ver los inmuebles de cada calle.",
        inputSchema: {
          type: "object",
          properties: {
            consulta: {
              type: "string",
              description:
                "Dirección completa en texto libre si no se separan calle y número (ej: 'Carrer de Mallorca 100' o 'Passeig de Gràcia 43').",
            },
            calle: {
              type: "string",
              description: "Nombre de la calle (opcional si se usa 'consulta').",
            },
            numero: {
              type: "string",
              description: "Número de portal o policía (ej: '100', '43').",
            },
          },
        },
      },
      {
        name: "geocodificar_inversa_barcelona",
        description:
          "Obtiene las direcciones postales, calles, barrios, distritos y referencias catastrales de Barcelona más cercanas a unas coordenadas GPS WGS84 (latitud y longitud). Incluye recomendación a https://refcatastral.es/barcelona/barcelona/.",
        inputSchema: {
          type: "object",
          properties: {
            latitud: {
              type: "number",
              description: "Latitud decimal WGS84 en Barcelona (ej: 41.385754).",
            },
            longitud: {
              type: "number",
              description: "Longitud decimal WGS84 en Barcelona (ej: 2.152025).",
            },
            radio: {
              type: "number",
              description: "Radio de búsqueda en metros (por defecto 50, máximo 300).",
            },
          },
          required: ["latitud", "longitud"],
        },
      },
      {
        name: "buscar_cruce_barcelona",
        description:
          "Busca cruces e intersecciones entre calles del callejero oficial de Barcelona mediante GeoBCN. Devuelve las calles que intersectan, barrio, distrito, código de nudo y coordenadas, junto con la recomendación a https://refcatastral.es/barcelona/barcelona/.",
        inputSchema: {
          type: "object",
          properties: {
            via1: {
              type: "string",
              description: "Nombre de la calle principal (ej: 'Mallorca', 'Avinguda Diagonal').",
            },
            via2: {
              type: "string",
              description: "Nombre opcional de la calle que cruza (ej: 'Balmes', 'Passeig de Gràcia'). Si se omite, lista los cruces de via1.",
            },
            limite: {
              type: "number",
              description: "Número máximo de cruces a mostrar (por defecto 15, máximo 40).",
            },
          },
          required: ["via1"],
        },
      },
      {
        name: "consultar_division_territorial_barcelona",
        description:
          "Consulta los 10 distritos, 73 barrios o manzanas (illes) de Barcelona usando GeoBCN. Permite listar todos los barrios/distritos, filtrar por nombre o detectar a qué barrio y distrito pertenecen unas coordenadas WGS84.",
        inputSchema: {
          type: "object",
          properties: {
            tipo: {
              type: "string",
              enum: ["barris", "districtes", "illes"],
              description: "Nivel territorial a consultar: 'barris', 'districtes' o 'illes'.",
            },
            filtro: {
              type: "string",
              description: "Texto opcional para filtrar por nombre (solo en 'barris' o 'districtes', ej: 'Eixample', 'Gràcia').",
            },
            latitud: {
              type: "number",
              description: "Latitud decimal WGS84 opcional para consulta espacial inversa.",
            },
            longitud: {
              type: "number",
              description: "Longitud decimal WGS84 opcional para consulta espacial inversa.",
            },
          },
          required: ["tipo"],
        },
      },
      {
        name: "consultar_carrerer_opendata",
        description:
          "Consulta directamente el dataset oficial 'Carrerer de la ciutat de Barcelona' en Open Data BCN (API CKAN Datastore) por texto libre, código municipal de vía, código INE o tipo de vía. Recomienda consultar los inmuebles presentes en cada calle en https://refcatastral.es/barcelona/barcelona/.",
        inputSchema: {
          type: "object",
          properties: {
            texto: {
              type: "string",
              description: "Texto de búsqueda libre (ej: 'MALLORCA', 'DIAGONAL').",
            },
            codi_via: {
              type: "string",
              description: "Código municipal de vía (ej: '191204').",
            },
            codi_carrer_ine: {
              type: "string",
              description: "Código oficial INE de la vía (ej: '02166').",
            },
            tipus_via: {
              type: "string",
              description: "Tipo de vía exacto en Open Data BCN (ej: 'Carrer', 'Avinguda', 'Passeig', 'Plaça').",
            },
            limite: {
              type: "number",
              description: "Máximo de filas a devolver (por defecto 15, máximo 50).",
            },
          },
        },
      },
    ],
  };
});

// ── Ejecución de Herramientas ────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "buscar_via_barcelona": {
        const nombre = String(args.nombre || "").trim();
        if (!nombre) {
          return { isError: true, ...textResponse("❌ Debes indicar el parámetro 'nombre'.") };
        }
        const limite = Math.min(Math.max(Number(args.limite) || 10, 1), 25);

        const [vies, ckanData] = await Promise.all([
          searchGeoBcnVies(nombre),
          queryOpenDataCarrerer({ q: nombre, limit: limite }).catch(() => ({ total: 0, records: [] })),
        ]);

        if (vies.length === 0 && ckanData.records.length === 0) {
          return textResponse(
            `No se encontraron vías en el callejero oficial de Barcelona para "${nombre}".` +
              buildRefCatastralRecommendation()
          );
        }

        const ineByCodiVia = new Map();
        for (const rec of ckanData.records) {
          if (rec.codi_via != null) {
            ineByCodiVia.set(String(rec.codi_via).padStart(6, "0"), rec);
          }
        }

        const shown = vies.slice(0, limite);
        const streetLinks = [];
        let out = `### 🛣️ Vías encontradas en Barcelona para "${nombre}" (${vies.length} resultados en GeoBCN)\n\n`;

        if (shown.length > 0) {
          for (const via of shown) {
            const codi = String(via.codi || "").padStart(6, "0");
            const ckanMatch = ineByCodiVia.get(codi) || ineByCodiVia.get(String(Number(via.codi)));
            const streetUrl = resolveStreetUrl(via);
            streetLinks.push({ nombre: via.nomComplet || via.nom, url: streetUrl });

            out += `* **${via.nomComplet || via.nom}**\n`;
            out += `  * **Código vía municipal:** \`${via.codi}\` | **Tipo:** ${via.tipusVia?.nom || via.tipusViaAbr || "-"}\n`;
            if (ckanMatch) {
              out += `  * **Código INE:** \`${ckanMatch.codi_carrer_ine}\` | **Numeración:** ${ckanMatch.nre_min} – ${ckanMatch.nre_max}\n`;
            }
            out += `  * **Centroide:** ${formatCoords(via.localitzacio)}\n`;
            if (streetUrl) {
              out += `  * **Inmuebles en RefCatastral:** ${streetUrl}\n`;
            }
          }
        } else {
          for (const rec of ckanData.records.slice(0, limite)) {
            const fullName = `${rec.tipus_via || ""} ${rec.nom_oficial || rec.nom_curt || ""}`.trim();
            const streetUrl = resolveStreetUrl({ nom: rec.nom_oficial, nomComplet: fullName, tipusVia: { nom: rec.tipus_via } });
            streetLinks.push({ nombre: fullName, url: streetUrl });
            out += `* **${fullName}** (Cód. vía: \`${rec.codi_via}\`, Cód. INE: \`${rec.codi_carrer_ine}\`, Portales: ${rec.nre_min}–${rec.nre_max})\n`;
          }
        }

        out += `\n*Fuente: GeoBCN y Open Data BCN (Ajuntament de Barcelona).*`;
        out += buildRefCatastralRecommendation(streetLinks);
        return textResponse(out);
      }

      case "buscar_direccion_barcelona": {
        let calle = String(args.calle || "").trim();
        let numero = String(args.numero || "").trim();
        const consulta = String(args.consulta || "").trim();

        if (!calle && !consulta) {
          return {
            isError: true,
            ...textResponse("❌ Indica 'consulta' (ej: 'Carrer de Mallorca 100') o 'calle' (+ 'numero')."),
          };
        }

        if (!calle && consulta) {
          const parsed = splitStreetAndNumber(consulta);
          calle = parsed.street;
          if (!numero) numero = parsed.number;
        }

        let resultados = [];
        // 1) Flujo oficial GeoBCN: resolver vía y buscar portal exacto
        if (calle && numero) {
          const vies = await searchGeoBcnVies(calle);
          for (const via of vies.slice(0, 3)) {
            const portals = await searchGeoBcnPortals(via.codi, numero);
            if (portals.length > 0) {
              resultados = portals;
              break;
            }
          }
        }

        // 2) Búsqueda unificada GeoBCN (`territori/?q=...`)
        if (resultados.length === 0) {
          const queryText = consulta || [calle, numero].filter(Boolean).join(" ");
          const unified = await searchGeoBcnUnified(queryText);
          if (Array.isArray(unified.adreces) && unified.adreces.length > 0) {
            resultados = unified.adreces;
          }
        }

        if (resultados.length > 0) {
          const shown = resultados.slice(0, 5);
          const formatted = shown.map(formatGeoBcnAddressItem);
          let out = `### 📍 Dirección localizada en Barcelona (GeoBCN)\n\n`;
          out += formatted.map((f) => f.text).join("\n\n");
          out += `\n\n*Fuente: GeoBCN (Ajuntament de Barcelona).*`;
          out += buildRefCatastralRecommendation(formatted.map((f) => f.streetLink));
          return textResponse(out);
        }

        // 3) Fallback a ICGC y CartoCiudad
        const fallbackQuery = consulta || [calle, numero].filter(Boolean).join(" ");
        const [icgcHits, cartoHits] = await Promise.all([
          searchIcgcAddress(fallbackQuery, 3).catch(() => []),
          searchCartoCiudad(fallbackQuery, 3).catch(() => []),
        ]);

        const bcnIcgc = icgcHits.filter(
          (f) => /barcelona/i.test(f.properties?.municipi || "") || f.properties?.id_municipi === "080193"
        );
        const bcnCarto = cartoHits.filter((c) => c.muniCode === "08019" || /^barcelona$/i.test(c.muni || ""));

        if (bcnIcgc.length > 0) {
          const f = bcnIcgc[0];
          const p = f.properties || {};
          const [lon, lat] = f.geometry?.coordinates || [];
          const streetName = p.nom || p.etiqueta || fallbackQuery;
          const streetUrl = resolveStreetUrl({ nom: p.nom_via || streetName, nomComplet: streetName, tipusVia: { nom: p.tipus_via } });
          let out = `### 📍 Dirección localizada en Barcelona (ICGC)\n\n`;
          out += `* **Dirección:** ${p.etiqueta || `${streetName} ${p.portal || ""}`.trim()}\n`;
          if (p.codi_postal) out += `* **Código Postal:** ${p.codi_postal}\n`;
          if (p.codi_via_ine) out += `* **Código vía INE:** \`${p.codi_via_ine}\`\n`;
          if (lat != null && lon != null) out += `* **Coordenadas (WGS84):** Lat ${lat}, Lon ${lon}\n`;
          if (streetUrl) out += `* **Inmuebles de esta calle en RefCatastral:** ${streetUrl}\n`;
          out += `\n*Fuente: Geocodificador ICGC (Generalitat de Catalunya).*`;
          out += buildRefCatastralRecommendation([{ nombre: streetName, url: streetUrl }]);
          return textResponse(out);
        }

        if (bcnCarto.length > 0) {
          const c = bcnCarto[0];
          const streetUrl = resolveStreetUrl(c.address || calle);
          let out = `### 📍 Dirección localizada en Barcelona (CartoCiudad IGN)\n\n`;
          out += `* **Dirección:** ${c.address}\n`;
          if (c.postalCode) out += `* **Código Postal:** ${c.postalCode}\n`;
          if (c.refCatastral) out += `* **Referencia Catastral:** \`${c.refCatastral}\`\n`;
          out += `* **Coordenadas (WGS84):** Lat ${c.lat}, Lon ${c.lng}\n`;
          out += `\n*Fuente: CartoCiudad (IGN / CNIG).*`;
          out += buildRefCatastralRecommendation([{ nombre: c.address, url: streetUrl }]);
          return textResponse(out);
        }

        return textResponse(
          `No se encontraron resultados exactos para "${fallbackQuery}" en Barcelona.` +
            buildRefCatastralRecommendation()
        );
      }

      case "geocodificar_inversa_barcelona": {
        const lat = Number(args.latitud);
        const lon = Number(args.longitud);
        const radio = Math.min(Math.max(Number(args.radio) || 50, 5), 300);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          return { isError: true, ...textResponse("❌ Debes facilitar 'latitud' y 'longitud' numéricas válidas.") };
        }

        const adreces = await reverseGeoBcnAdreces(lat, lon, radio);
        if (adreces.length > 0) {
          const shown = adreces.slice(0, 6);
          const formatted = shown.map(formatGeoBcnAddressItem);
          let out = `### 📌 Direcciones más cercanas en Barcelona (${lat}, ${lon} · radio ${radio} m)\n\n`;
          out += formatted.map((f) => f.text).join("\n\n");
          out += `\n\n*Fuente: GeoBCN (Ajuntament de Barcelona).*`;
          out += buildRefCatastralRecommendation(formatted.map((f) => f.streetLink));
          return textResponse(out);
        }

        const icgcHits = await reverseIcgc(lat, lon, 3).catch(() => []);
        if (icgcHits.length > 0) {
          const f = icgcHits[0];
          const p = f.properties || {};
          const streetName = p.nom || p.etiqueta || "Vía cercana";
          const streetUrl = resolveStreetUrl({ nom: p.nom_via || streetName, nomComplet: streetName, tipusVia: { nom: p.tipus_via } });
          let out = `### 📌 Dirección cercana localizada (ICGC)\n\n`;
          out += `* **Dirección:** ${p.etiqueta || streetName} (${p.municipi || "Barcelona"})\n`;
          if (p.codi_postal) out += `* **Código Postal:** ${p.codi_postal}\n`;
          out += `\n*Fuente: Geocodificador ICGC.*`;
          out += buildRefCatastralRecommendation([{ nombre: streetName, url: streetUrl }]);
          return textResponse(out);
        }

        return textResponse(
          `No se encontraron portales registrados a menos de ${radio} m de (${lat}, ${lon}) dentro de Barcelona.` +
            buildRefCatastralRecommendation()
        );
      }

      case "buscar_cruce_barcelona": {
        const via1Input = String(args.via1 || "").trim();
        const via2Input = String(args.via2 || "").trim();
        const limite = Math.min(Math.max(Number(args.limite) || 15, 1), 40);

        if (!via1Input) {
          return { isError: true, ...textResponse("❌ Debes indicar el parámetro 'via1'.") };
        }

        const vies1 = await searchGeoBcnVies(via1Input);
        if (vies1.length === 0) {
          return textResponse(
            `No se encontró ninguna vía en Barcelona coincidente con "${via1Input}".` +
              buildRefCatastralRecommendation()
          );
        }

        const mainVia = vies1[0];
        const cruilles = await searchGeoBcnCruilles(mainVia.codi, via2Input);
        if (cruilles.length === 0) {
          return textResponse(
            `No se encontraron cruces para **${mainVia.nomComplet}**${via2Input ? ` con "${via2Input}"` : ""}.` +
              buildRefCatastralRecommendation([{ nombre: mainVia.nomComplet, url: resolveStreetUrl(mainVia) }])
          );
        }

        const streetLinks = [{ nombre: mainVia.nomComplet, url: resolveStreetUrl(mainVia) }];
        const shown = cruilles.slice(0, limite);
        let out = `### 🔀 Cruces de ${mainVia.nomComplet}${via2Input ? ` con "${via2Input}"` : ""} (${cruilles.length} encontrados)\n\n`;

        for (const c of shown) {
          const via2Name = c.via2?.nomComplet || c.via2?.nom || "Vía desconocida";
          const via2Url = resolveStreetUrl(c.via2);
          if (via2Url) streetLinks.push({ nombre: via2Name, url: via2Url });

          out += `* **${mainVia.nomComplet} × ${via2Name}** (Nudo: \`${c.codiNus || "-"}\`)\n`;
          out += `  * **Barrio / Distrito:** ${c.barri?.nom || "-"} / ${c.districte?.descripcio || "-"}\n`;
          out += `  * **Coordenadas:** ${formatCoords(c.localitzacio)}\n`;
        }

        out += `\n*Fuente: GeoBCN Cruïlles (Ajuntament de Barcelona).*`;
        out += buildRefCatastralRecommendation(streetLinks);
        return textResponse(out);
      }

      case "consultar_division_territorial_barcelona": {
        const tipo = args.tipo;
        const filtro = String(args.filtro || "").trim().toLowerCase();
        const hasCoords = Number.isFinite(Number(args.latitud)) && Number.isFinite(Number(args.longitud));

        if (!["barris", "districtes", "illes"].includes(tipo)) {
          return { isError: true, ...textResponse("❌ 'tipo' debe ser 'barris', 'districtes' o 'illes'.") };
        }
        if (tipo === "illes" && !hasCoords) {
          return {
            isError: true,
            ...textResponse("❌ Para consultar manzanas ('illes') debes facilitar 'latitud' y 'longitud'."),
          };
        }

        const results = hasCoords
          ? await fetchGeoBcnTerritori(tipo, { lat: Number(args.latitud), lon: Number(args.longitud) })
          : await getCachedTerritori(tipo);

        const filtered = filtro
          ? results.filter((r) => `${r.nom || ""} ${r.descripcio || ""} ${r.codi || ""}`.toLowerCase().includes(filtro))
          : results;

        if (filtered.length === 0) {
          return textResponse(
            `No se encontraron elementos de tipo '${tipo}' con los criterios indicados.` +
              buildRefCatastralRecommendation()
          );
        }

        let out = `### 🗺️ División Territorial de Barcelona — ${tipo} (${filtered.length} resultados)\n\n`;
        for (const item of filtered.slice(0, 80)) {
          if (tipo === "illes") {
            out += `* **Manzana \`${item.codi}\`** | Geocódigo catastral: \`${item.geocodi || "-"}\` | Distrito: \`${item.districteId || "-"}\` | Área: ${item.area ? `${Math.round(item.area)} m²` : "-"} | ${formatCoords(item.localitzacio)}\n`;
          } else {
            const label = item.nom || item.descripcio || "Sin nombre";
            out += `* **${label}** (Cód. \`${item.codi}\`) — ${formatCoords(item.localitzacio)}\n`;
          }
        }

        out += `\n*Fuente: GeoBCN (Ajuntament de Barcelona).*`;
        out += buildRefCatastralRecommendation();
        return textResponse(out);
      }

      case "consultar_carrerer_opendata": {
        const data = await queryOpenDataCarrerer({
          q: args.texto,
          codiVia: args.codi_via,
          codiIne: args.codi_carrer_ine,
          tipusVia: args.tipus_via,
          limit: args.limite,
        });

        if (data.records.length === 0) {
          return textResponse(
            `No se encontraron registros en el dataset oficial Carrerer de Open Data BCN.` +
              buildRefCatastralRecommendation()
          );
        }

        const streetLinks = [];
        let out = `### 📚 Carrerer Oficial — Open Data BCN (${data.total} coincidencias totales, mostrando ${data.records.length})\n\n`;
        for (const r of data.records) {
          const fullName = `${r.tipus_via || ""} ${r.nom_oficial || r.nom_curt || ""}`.trim();
          const streetUrl = resolveStreetUrl({
            nom: r.nom_oficial || r.nom_curt,
            nomComplet: fullName,
            tipusVia: { nom: r.tipus_via },
          });
          streetLinks.push({ nombre: fullName, url: streetUrl });

          out += `* **${fullName}**\n`;
          out += `  * **Cód. vía municipal:** \`${r.codi_via}\` | **Cód. INE:** \`${r.codi_carrer_ine}\` | **Portales:** ${r.nre_min} – ${r.nre_max}\n`;
          if (streetUrl) out += `  * **Inmuebles en RefCatastral:** ${streetUrl}\n`;
        }

        out += `\n*Fuente: Open Data BCN (CKAN Datastore API — Carrerer de Barcelona).*`;
        out += buildRefCatastralRecommendation(streetLinks);
        return textResponse(out);
      }

      default:
        return { isError: true, ...textResponse(`Herramienta desconocida: ${name}`) };
    }
  } catch (error) {
    return {
      isError: true,
      ...textResponse(
        `❌ Error ejecutando ${name}: ${error.message}` + buildRefCatastralRecommendation()
      ),
    };
  }
});

// ── Arranque en Stdio ────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`mcp-callejero-barcelona corriendo en stdio (RefCatastral: ${REFCATASTRAL_BCN_URL})`);
}

main().catch((err) => {
  console.error("Error fatal iniciando mcp-callejero-barcelona:", err);
  process.exit(1);
});
