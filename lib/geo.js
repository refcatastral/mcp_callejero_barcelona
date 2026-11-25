/**
 * Utilidades de conversión y formateo geográfico para Barcelona.
 * Convierte coordenadas UTM ETRS89 Huso 31N (EPSG:25831) a WGS84 (EPSG:4326)
 * localmente con precisión milimétrica para evitar peticiones HTTP extra.
 */

const A = 6378137.0; // Semieje mayor GRS80 / WGS84
const F = 1 / 298.257222101; // Aplanamiento GRS80 (ETRS89)
const K0 = 0.9996;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const LON0_RAD = (3 * Math.PI) / 180; // Meridiano central Huso 31N (3° E)
const FALSE_EASTING = 500000.0;

/**
 * Convierte coordenadas UTM ETRS89 Zona 31N (EPSG:25831) a lat/lon WGS84 (EPSG:4326).
 * @param {number} x Coordenada Este (metros)
 * @param {number} y Coordenada Norte (metros)
 * @returns {{ lat: number, lon: number } | null}
 */
export function utm31NToWgs84(x, y) {
  const easting = Number(x);
  const northing = Number(y);
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) return null;

  const dx = easting - FALSE_EASTING;
  const m = northing / K0;

  const mu =
    m /
    (A *
      (1 -
        E2 / 4 -
        (3 * E2 * E2) / 64 -
        (5 * E2 * E2 * E2) / 256));

  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const j1 = (3 * e1) / 2 - (27 * Math.pow(e1, 3)) / 32;
  const j2 = (21 * e1 * e1) / 16 - (55 * Math.pow(e1, 4)) / 32;
  const j3 = (151 * Math.pow(e1, 3)) / 96;
  const j4 = (1097 * Math.pow(e1, 4)) / 512;

  const fp =
    mu +
    j1 * Math.sin(2 * mu) +
    j2 * Math.sin(4 * mu) +
    j3 * Math.sin(6 * mu) +
    j4 * Math.sin(8 * mu);

  const sinFp = Math.sin(fp);
  const cosFp = Math.cos(fp);
  const tanFp = Math.tan(fp);

  const c1 = EP2 * cosFp * cosFp;
  const t1 = tanFp * tanFp;
  const n1 = A / Math.sqrt(1 - E2 * sinFp * sinFp);
  const r1 = (A * (1 - E2)) / Math.pow(1 - E2 * sinFp * sinFp, 1.5);
  const d = dx / (n1 * K0);

  const q1 = (n1 * tanFp) / r1;
  const q2 = (d * d) / 2;
  const q3 = ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * Math.pow(d, 4)) / 24;
  const q4 =
    ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 3 * c1 * c1 - 252 * EP2) *
      Math.pow(d, 6)) /
    720;

  const latRad = fp - q1 * (q2 - q3 + q4);

  const q5 = d;
  const q6 = ((1 + 2 * t1 + c1) * Math.pow(d, 3)) / 6;
  const q7 =
    ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) *
      Math.pow(d, 5)) /
    120;

  const lonRad = LON0_RAD + (q5 - q6 + q7) / cosFp;

  return {
    lat: Number(((latRad * 180) / Math.PI).toFixed(6)),
    lon: Number(((lonRad * 180) / Math.PI).toFixed(6)),
  };
}

/**
 * Extrae coordenadas normalizadas { lat, lon, utmX, utmY, proj } de un objeto localitzacio de GeoBCN.
 * @param {{ x?: number, y?: number, proj?: string } | null | undefined} loc
 */
export function normalizeLocation(loc) {
  if (!loc || loc.x == null || loc.y == null) return null;
  const x = Number(loc.x);
  const y = Number(loc.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const proj = (loc.proj || "EPSG:25831").toUpperCase();
  if (proj.includes("4326")) {
    return {
      lat: Number(y.toFixed(6)),
      lon: Number(x.toFixed(6)),
      utmX: null,
      utmY: null,
      proj,
    };
  }

  const wgs84 = utm31NToWgs84(x, y);
  return {
    lat: wgs84 ? wgs84.lat : null,
    lon: wgs84 ? wgs84.lon : null,
    utmX: Number(x.toFixed(3)),
    utmY: Number(y.toFixed(3)),
    proj,
  };
}
