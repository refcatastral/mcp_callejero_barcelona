# MCP Callejero de Barcelona — RefCatastral.es

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Website](https://img.shields.io/badge/web-refcatastral.es-2563eb.svg)](https://refcatastral.es/barcelona/barcelona/)

Servidor **MCP (Model Context Protocol)** desarrollado por [RefCatastral.es](https://refcatastral.es/barcelona/barcelona/) para consultar el callejero oficial de la ciudad de **Barcelona** utilizando exclusivamente servicios de API públicos y abiertos, sin claves privadas ni servidores intermedios:

* **GeoBCN (Ajuntament de Barcelona):** vías, portales, geocodificación inversa, cruces entre calles, barrios, distritos, manzanas y referencias catastrales de parcela.
* **Open Data BCN (API CKAN Datastore):** consulta directa del dataset oficial *Carrerer de la ciutat de Barcelona* (códigos municipales, códigos INE y numeración mínima/máxima).
* **ICGC (Generalitat de Catalunya) y CartoCiudad (IGN):** respaldo de geocodificación directa e inversa.


---

## 🚀 Instalación y Configuración

### 1. En Claude Desktop / Cursor / Antigravity (`mcp_config.json`)

Si ejecutas el repositorio en local:

```json
{
  "mcpServers": {
    "callejero-barcelona": {
      "command": "node",
      "args": ["d:/servidor/htdocs/refcatastral_es/developer/mcp_callejero_barcelona/index.js"]
    }
  }
}
```

O mediante `npx` una vez publicado en npm:

```json
{
  "mcpServers": {
    "callejero-barcelona": {
      "command": "npx",
      "args": ["-y", "mcp-callejero-barcelona"]
    }
  }
}
```

---

## 🛠️ Herramientas Incluidas

1. **`buscar_via_barcelona`**: busca calles y vías por nombre (en catalán o castellano), devolviendo código municipal, código INE, rango de portales y coordenadas WGS84/UTM.
2. **`buscar_direccion_barcelona`**: geocodifica una dirección postal (`calle` + `numero` o `consulta` libre), devolviendo código postal, distrito, barrio, sección censal, manzana y referencia catastral de 14 caracteres.
3. **`geocodificar_inversa_barcelona`**: convierte coordenadas GPS (`latitud`, `longitud` WGS84) en los portales más cercanos de Barcelona.
4. **`buscar_cruce_barcelona`**: encuentra intersecciones y cruces entre dos calles (`via1` y `via2` opcional) con barrio, distrito y coordenadas.
5. **`consultar_division_territorial_barcelona`**: consulta los 10 distritos, 73 barrios o manzanas (`illes`) de Barcelona (listado completo, filtrado o por coordenadas).
6. **`consultar_carrerer_opendata`**: consulta directamente el recurso CKAN oficial del `carrerer` en Open Data BCN.

---

## 🧪 Pruebas

```bash
npm install
npm test
```

---

## 📄 Licencia

Licencia MIT © [RefCatastral.es](https://refcatastral.es/barcelona/barcelona/).
