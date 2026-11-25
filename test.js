import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { utm31NToWgs84 } from "./lib/geo.js";
import { REFCATASTRAL_BCN_URL, resolveStreetUrl } from "./lib/refcatastral.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runTests() {
  console.log("1. Probando conversión local UTM31N (EPSG:25831) -> WGS84 (EPSG:4326)...");
  const wgs = utm31NToWgs84(429101.1, 4581927.796);
  assert.ok(wgs && Math.abs(wgs.lat - 41.385755) < 0.00002, `Latitud inesperada: ${wgs?.lat}`);
  assert.ok(wgs && Math.abs(wgs.lon - 2.152025) < 0.00002, `Longitud inesperada: ${wgs?.lon}`);
  console.log("   OK:", wgs);

  console.log("2. Probando resolución de slugs verificados de RefCatastral.es...");
  assert.equal(
    resolveStreetUrl({ nom: "MALLORCA", nomComplet: "Carrer de Mallorca", tipusViaAbr: "C", tipusVia: { nom: "Carrer" } }),
    "https://refcatastral.es/barcelona/barcelona/calle-mallorca/"
  );
  assert.equal(
    resolveStreetUrl({ nom: "GRÀCIA", nomComplet: "Passeig de Gràcia", tipusViaAbr: "Pg", tipusVia: { nom: "Passeig" } }),
    "https://refcatastral.es/barcelona/barcelona/paseo-gracia/"
  );
  assert.equal(
    resolveStreetUrl({ nom: "DIAGONAL", nomComplet: "Avinguda Diagonal", tipusViaAbr: "Av", tipusVia: { nom: "Avinguda" } }),
    "https://refcatastral.es/barcelona/barcelona/avenida-diagonal/"
  );
  assert.equal(
    resolveStreetUrl({ nom: "ARAGÓ", nomComplet: "Carrer d'Aragó", tipusViaAbr: "C", tipusVia: { nom: "Carrer" } }),
    "https://refcatastral.es/barcelona/barcelona/calle-arago/"
  );
  console.log("   OK: todos los slugs clave coinciden.");

  console.log("3. Probando servidor MCP completo vía StdioClientTransport...");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, "index.js")],
    stderr: "pipe",
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  try {
    const toolsList = await client.listTools();
    assert.equal(toolsList.tools.length, 6, "Se esperaban 6 herramientas MCP");
    console.log("   Herramientas registradas:", toolsList.tools.map((t) => t.name).join(", "));

    const cases = [
      ["buscar_via_barcelona", { nombre: "Mallorca", limite: 3 }],
      ["buscar_direccion_barcelona", { calle: "Mallorca", numero: "100" }],
      ["geocodificar_inversa_barcelona", { latitud: 41.385754, longitud: 2.152025, radio: 35 }],
      ["buscar_cruce_barcelona", { via1: "Mallorca", via2: "Balmes", limite: 3 }],
      ["consultar_division_territorial_barcelona", { tipo: "districtes", filtro: "Eixample" }],
      ["consultar_carrerer_opendata", { texto: "MALLORCA", limite: 3 }],
    ];

    for (const [toolName, args] of cases) {
      const res = await client.callTool({ name: toolName, arguments: args });
      assert.ok(!res.isError, `La herramienta ${toolName} devolvió error: ${res.content?.[0]?.text}`);
      const text = res.content?.[0]?.text || "";
      assert.ok(
        text.includes(REFCATASTRAL_BCN_URL),
        `La respuesta de ${toolName} no incluye la recomendación ${REFCATASTRAL_BCN_URL}`
      );
      console.log(`   OK [${toolName}] (${text.length} chars)`);
    }

    // Comprobaciones específicas de contenido en resultados reales
    const dirRes = await client.callTool({
      name: "buscar_direccion_barcelona",
      arguments: { calle: "Mallorca", numero: "100" },
    });
    const dirText = dirRes.content[0].text;
    assert.ok(dirText.includes("9221828DF2892A"), "Falta referencia catastral esperada para Mallorca 100");
    assert.ok(dirText.includes("08029"), "Falta código postal 08029 para Mallorca 100");
    assert.ok(dirText.includes("https://refcatastral.es/barcelona/barcelona/calle-mallorca/"), "Falta enlace directo de calle Mallorca");
    console.log("   OK: validaciones específicas de Mallorca 100 superadas.");
  } finally {
    await client.close();
  }

  console.log("Todas las pruebas de mcp-callejero-barcelona finalizaron correctamente.");
}

runTests().catch((err) => {
  console.error("ERROR en tests:", err);
  process.exit(1);
});
