"use server";

import { requireSession } from "@/shared/lib/auth/session";
import {
  canUseGoogleMaps,
  trackGoogleApiCall,
} from "@/shared/lib/google-maps/config";
import { provinceFromPostalCode, provincesMatch } from "@/shared/lib/validations/spanish";
import type { ReverseGeocode } from "./nominatim";
import { detectStreetType } from "./street-type";
import {
  buscarCartociudad,
  candidatosCartociudad,
  detalleCartociudad,
  reverseCartociudad,
} from "./cartociudad";
import {
  calleDeConsulta,
  callesParecidas,
  candidatoEnSitio,
  capitalizarNombre,
  distanciaMetros,
  elegirCandidatoCalle,
  municipiosCoinciden,
  numerosCoinciden,
  partesCalle,
  provinciaPreferida,
  quitarParticulasIniciales,
  tieneCoordenadas,
  tipoViaDesde,
  type CandidatoCartociudad,
} from "./direccion-texto";
import { lookupPostalCodesByMunicipality } from "./municipalities";

// ─────────────────────────────────────────────────────────────────────
// Sesión → empresa (las acciones NUNCA reciben companyId por parámetro)
// ─────────────────────────────────────────────────────────────────────

interface Contexto {
  companyId: string | null;
  userId: string | null;
}

async function contexto(): Promise<Contexto> {
  try {
    const s = await requireSession();
    return { companyId: s.company_id ?? null, userId: s.user_id };
  } catch {
    // Sin sesión: sin Google (solo CartoCiudad y Nominatim).
    return { companyId: null, userId: null };
  }
}

/** Clave de Google si la empresa puede usarlo ahora mismo (módulo, clave, topes). */
async function claveGoogle(ctx: Contexto): Promise<string | null> {
  if (!ctx.companyId) return null;
  const gm = await canUseGoogleMaps({ companyId: ctx.companyId });
  return gm.ok ? gm.key : null;
}

async function registrarGoogle(
  ctx: Contexto,
  endpoint: "reverse" | "forward",
  errorCode: string | null,
): Promise<void> {
  if (!ctx.companyId) return;
  await trackGoogleApiCall({
    companyId: ctx.companyId,
    api: "geocoding",
    endpoint,
    userId: ctx.userId,
    ...(errorCode ? { success: false, errorCode } : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Reverse: CartoCiudad → Google → Nominatim
// ─────────────────────────────────────────────────────────────────────

/** Más lejos que esto, el portal que da CartoCiudad no es «esta casa». */
const REVERSE_MAX_NUMERO_M = 100;
const REVERSE_MAX_CALLE_M = 400;

function reverseDesdeCartociudad(
  c: CandidatoCartociudad,
  conCalle: boolean,
  conNumero: boolean,
): ReverseGeocode {
  const { tipo, nombre } = partesCalle(c);
  const calle = conCalle ? capitalizarNombre(nombre) : "";
  const numero = conCalle && conNumero && c.portalNumber != null ? String(c.portalNumber) : null;
  const tipoVia = tipoViaDesde(tipo);
  const etiquetaTipo = tipo ? capitalizarNombre(tipo) : "";
  return {
    street_type: tipoVia,
    street: calle,
    street_number: numero,
    postal_code: c.postalCode,
    city: c.muni ?? c.poblacion,
    province: provinciaPreferida(c.postalCode, c.province),
    display_name: [
      calle ? `${etiquetaTipo} ${calle}${numero ? ` ${numero}` : ""}`.trim() : "",
      [c.postalCode, c.muni].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(", "),
    fuente: "cartociudad",
  };
}

/**
 * Reverse geocoding: CartoCiudad (portal + número + CP del IGN) primero;
 * Google si la empresa lo tiene activo; Nominatim al final. Registra el
 * uso de Google en google_api_usage.
 *
 * Devuelve null si todo falla — el que llama gestiona el «no se pudo».
 */
export async function reverseGeocodeAction(
  lat: number,
  lng: number,
): Promise<ReverseGeocode | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // 1) CartoCiudad. Solo cubre España; fuera devuelve vacío y seguimos.
  let parcial: ReverseGeocode | null = null;
  const cc = await reverseCartociudad(lat, lng);
  if (cc && cc.muni) {
    const d = tieneCoordenadas(cc) ? distanciaMetros({ lat, lng }, cc) : Infinity;
    if (d <= REVERSE_MAX_CALLE_M) {
      return reverseDesdeCartociudad(cc, true, d <= REVERSE_MAX_NUMERO_M);
    }
    // Portal lejano (campo, urbanización sin numerar): el CP y el municipio
    // valen, la calle no. Probamos los demás por si conocen la calle.
    parcial = reverseDesdeCartociudad(cc, false, false);
  }

  // 2) Google
  const ctx = await contexto();
  const key = await claveGoogle(ctx);
  if (key) {
    const g = await reverseGoogle(lat, lng, key);
    await registrarGoogle(ctx, "reverse", g.result ? null : g.errorCode);
    if (g.result) return { ...g.result, fuente: "google" };
  }

  // 3) Nominatim
  const n = await reverseNominatim(lat, lng);
  if (n) return { ...n, fuente: "nominatim" };
  return parcial;
}

// ─────────────────────────────────────────────────────────────────────
// Forward libre (backlog, almacenes, rutas): Google → Nominatim, con filtro
// anti-«otra calle»
// ─────────────────────────────────────────────────────────────────────

/**
 * Geocodifica un texto libre. Lo usan el backlog de direcciones, el alta
 * server-side de direcciones/almacenes y el cálculo de rutas, así que NO
 * cambia de firma. Filtro nuevo: Google ya no vale si su resultado es
 * `partial_match` o si trae una calle que no se parece a la de la consulta
 * (antes, para «Carrer Monasteri 17, 07300 Inca» devolvía «Carrer de Ses
 * Monges, 129» y se guardaban coordenadas falsas sin avisar).
 */
export async function forwardGeocodeAction(
  query: string,
): Promise<{ lat: number; lng: number } | null> {
  const q = String(query ?? "").slice(0, 300);
  if (!q.trim()) return null;
  const calleEsperada = calleDeConsulta(q);
  const ctx = await contexto();
  const key = await claveGoogle(ctx);
  if (key) {
    const g = await geocodeGoogle({ address: q, components: "country:ES" }, key, "forward");
    await registrarGoogle(ctx, "forward", g.result ? null : g.errorCode);
    if (g.result) {
      const ok = g.result.find((r) => {
        if (r.partial_match) return false;
        const via = componente(r, "route");
        return !via || !calleEsperada || callesParecidas(calleEsperada, via);
      });
      if (ok) return { lat: ok.geometry.location.lat, lng: ok.geometry.location.lng };
    }
  }
  return forwardNominatim(q, calleEsperada);
}

// ─────────────────────────────────────────────────────────────────────
// Resolver una dirección por campos (formularios de lead y de dirección)
// ─────────────────────────────────────────────────────────────────────

export interface EntradaDireccion {
  calle: string;
  numero?: string | null;
  cp?: string | null;
  poblacion: string;
  provincia?: string | null;
}

export interface DireccionResuelta {
  ok: boolean;
  lat?: number;
  lng?: number;
  cp?: string | null;
  poblacion?: string | null;
  provincia?: string | null;
  fuente: "cartociudad" | "google" | "nominatim" | null;
  /** true = portal con ese número en esa calle y ese municipio. false = como
   *  mucho la calle o el centro del pueblo: hay que mover la chincheta. */
  exacta: boolean;
  /** Cómo llama el mapa a la vía encontrada («Calle de les Monges 17»). */
  nombreEnMapa?: string | null;
}

function limpio(v: unknown, max = 160): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * Busca las coordenadas de UNA casa concreta. Orden:
 *  1. CartoCiudad: portal con ese número, en esa calle y en ese municipio
 *     (los resultados de otros municipios se descartan).
 *  2. Google: solo street_address/premise/subpremise, sin partial_match, con
 *     calle parecida, mismo número y mismo municipio.
 *  3. Nominatim, con el mismo filtro.
 * Si nada es exacto devuelve lo que sepa (calle o centro del pueblo, y el CP)
 * con `exacta:false`: el formulario centra ahí el mapa y pide la chincheta.
 */
export async function resolverDireccionAction(entrada: EntradaDireccion): Promise<DireccionResuelta> {
  const calle = limpio(entrada?.calle);
  const numero = limpio(entrada?.numero, 20);
  const cpRaw = limpio(entrada?.cp, 5);
  const cp = /^\d{5}$/.test(cpRaw) ? cpRaw : "";
  const poblacion = limpio(entrada?.poblacion, 100);
  const provincia = limpio(entrada?.provincia, 100);
  const nada: DireccionResuelta = { ok: false, exacta: false, fuente: null };
  if (!poblacion && !cp) return nada;

  const pedido = { calle, numero, cp, poblacion };
  let aprox: DireccionResuelta | null = null;

  if (calle) {
    // ── 1) CartoCiudad ──
    const texto = [calle, numero].filter(Boolean).join(" ");
    let { exacto, mismaCalle } = cp
      ? elegirCandidatoCalle(await candidatosCartociudad(texto, { cp, limite: 10 }), pedido)
      : { exacto: null, mismaCalle: null };
    // Sin CP: municipio_filter (solo funciona con el nombre oficial exacto,
    // «Inca» sí, «Palma de Mallorca» no) y, si no, texto libre con la
    // población (devuelve otros municipios: los filtra elegirCandidatoCalle).
    if (!exacto && poblacion && !cp) {
      const e2 = elegirCandidatoCalle(
        await candidatosCartociudad(texto, { municipio: poblacion, limite: 10 }),
        pedido,
      );
      exacto = e2.exacto;
      mismaCalle = mismaCalle ?? e2.mismaCalle;
    }
    if (!exacto && !mismaCalle && poblacion) {
      const e3 = elegirCandidatoCalle(
        await candidatosCartociudad(`${texto}, ${poblacion}`, { limite: 15 }),
        pedido,
      );
      exacto = e3.exacto;
      mismaCalle = mismaCalle ?? e3.mismaCalle;
    }
    // Las sugerencias a veces traen portales vecinos y no el pedido; find
    // con el nombre oficial de la calle sí lo encuentra. Verificado:
    // «CALLE DE LES MONGES 17, Inca» no da el 17 y «CALLE MONGES 17, Inca» sí.
    if (!exacto && numero && /^\d/.test(numero)) {
      const consultas: string[] = [];
      if (mismaCalle) {
        const nombre = partesCalle(mismaCalle).nombre;
        const sitio = mismaCalle.muni ?? poblacion;
        consultas.push(`${[mismaCalle.tip_via, nombre].filter(Boolean).join(" ")} ${numero}, ${sitio}`);
        const corto = quitarParticulasIniciales(nombre);
        if (corto !== nombre) {
          consultas.push(`${[mismaCalle.tip_via, corto].filter(Boolean).join(" ")} ${numero}, ${sitio}`);
        }
      } else {
        consultas.push(`${texto}, ${poblacion || cp}`);
      }
      for (const q of consultas) {
        const f = await buscarCartociudad(q);
        if (
          f &&
          f.type === "portal" &&
          tieneCoordenadas(f) &&
          candidatoEnSitio(f, pedido) &&
          callesParecidas(calle, partesCalle(f).nombre) &&
          numerosCoinciden(numero, f.portalNumber)
        ) {
          exacto = f;
          break;
        }
      }
    }
    if (exacto) {
      const { tipo, nombre } = partesCalle(exacto);
      const cpFinal = exacto.postalCode ?? cp ?? null;
      return {
        ok: true,
        exacta: true,
        fuente: "cartociudad",
        lat: exacto.lat,
        lng: exacto.lng,
        cp: cpFinal,
        poblacion: exacto.muni ?? exacto.poblacion,
        provincia: provinciaPreferida(cpFinal, exacto.province),
        nombreEnMapa: capitalizarNombre(
          [tipo, nombre, exacto.portalNumber != null ? String(exacto.portalNumber) : ""]
            .filter(Boolean)
            .join(" "),
        ),
      };
    }
    if (mismaCalle) {
      const conCoords = tieneCoordenadas(mismaCalle)
        ? mismaCalle
        : await detalleCartociudad(mismaCalle.id, mismaCalle.type);
      if (conCoords && tieneCoordenadas(conCoords)) {
        const { tipo, nombre } = partesCalle(mismaCalle);
        const cpCalle = mismaCalle.postalCode ?? (cp || null);
        aprox = {
          ok: true,
          exacta: false,
          fuente: "cartociudad",
          lat: conCoords.lat,
          lng: conCoords.lng,
          cp: cpCalle,
          poblacion: mismaCalle.muni ?? mismaCalle.poblacion,
          provincia: provinciaPreferida(cpCalle, mismaCalle.province),
          nombreEnMapa: capitalizarNombre([tipo, nombre].filter(Boolean).join(" ")),
        };
      }
    }

    // ── 2) Google ──
    const ctx = await contexto();
    const key = await claveGoogle(ctx);
    if (key && numero) {
      const address = [`${calle} ${numero}`.trim(), [cp, poblacion].filter(Boolean).join(" "), provincia, "España"]
        .filter(Boolean)
        .join(", ");
      const g = await geocodeGoogle({ address, components: "country:ES" }, key, "forward");
      await registrarGoogle(ctx, "forward", g.result ? null : g.errorCode);
      const r = g.result?.find((x) => googleEsExacto(x, pedido));
      if (r) {
        const cpG = componente(r, "postal_code") ?? (cp || null);
        return {
          ok: true,
          exacta: true,
          fuente: "google",
          lat: r.geometry.location.lat,
          lng: r.geometry.location.lng,
          cp: cpG,
          poblacion: localidadGoogle(r) ?? poblacion,
          provincia: provinciaPreferida(cpG, componente(r, "administrative_area_level_2")),
          nombreEnMapa: [componente(r, "route"), componente(r, "street_number")].filter(Boolean).join(" "),
        };
      }
    }

    // ── 3) Nominatim ──
    if (numero && /^\d/.test(numero)) {
      const n = await nominatimExacto(pedido);
      if (n) return n;
    }
  }

  if (aprox) return aprox;

  // ── Nada exacto ni de la calle: centro del pueblo + CP si lo sabemos ──
  const centro = poblacion ? await centroPoblacion(poblacion, provincia, cp) : null;
  let cpFinal: string | null = cp || null;
  if (!cpFinal && poblacion) cpFinal = (await cpDePoblacionInterno(poblacion, provincia)).cp;
  if (!centro && !cpFinal) return nada;
  return {
    ok: true,
    exacta: false,
    fuente: centro ? "cartociudad" : null,
    lat: centro?.lat,
    lng: centro?.lng,
    cp: cpFinal,
    poblacion: centro?.muni ?? (poblacion || null),
    provincia: provinciaPreferida(cpFinal, centro?.province ?? (provincia || null)),
    nombreEnMapa: null,
  };
}

async function centroPoblacion(
  poblacion: string,
  provincia: string,
  cp: string,
): Promise<CandidatoCartociudad | null> {
  const cands = await candidatosCartociudad(poblacion, { limite: 10 });
  const provCp = cp ? provinceFromPostalCode(cp) : null;
  const encaja = (c: CandidatoCartociudad) =>
    candidatoEnSitio(c, { poblacion }) &&
    (!provincia || provincesMatch((c.province ?? "").split("/")[0], provincia)) &&
    (!provCp || provincesMatch((c.province ?? "").split("/")[0], provCp));
  // «poblacion» = núcleo urbano (mejor centro que el término municipal).
  const elegido =
    cands.find((c) => c.type === "poblacion" && encaja(c)) ??
    cands.find((c) => c.type === "Municipio" && encaja(c)) ??
    null;
  if (!elegido) return null;
  if (tieneCoordenadas(elegido)) return elegido;
  const d = await detalleCartociudad(elegido.id, elegido.type);
  return d && tieneCoordenadas(d) ? { ...d, muni: d.muni ?? elegido.muni } : null;
}

// ─────────────────────────────────────────────────────────────────────
// Población → CP
// ─────────────────────────────────────────────────────────────────────

/**
 * CP de una población SOLO si tiene uno único. Si tiene varios, `varios:true`
 * y cp null (no se inventa). Fuentes: catálogo local CP↔municipio (o
 * Nominatim si está vacío) para saber si hay varios; Google Geocoding con
 * `components=locality:…` si la empresa lo tiene activo.
 */
export async function cpDePoblacionAction(
  poblacion: string,
  provincia?: string | null,
): Promise<{ cp: string | null; varios: boolean }> {
  return cpDePoblacionInterno(limpio(poblacion, 100), limpio(provincia, 100));
}

async function cpDePoblacionInterno(
  poblacion: string,
  provincia: string,
): Promise<{ cp: string | null; varios: boolean }> {
  if (poblacion.length < 2) return { cp: null, varios: false };
  const lista = await lookupPostalCodesByMunicipality(poblacion, provincia || undefined).catch(() => []);
  const distintos = new Set(
    lista
      .filter((h) => municipiosCoinciden(h.municipality, poblacion) && /^\d{5}$/.test(h.postal_code))
      .map((h) => h.postal_code),
  );
  if (distintos.size > 1) return { cp: null, varios: true };

  const ctx = await contexto();
  const key = await claveGoogle(ctx);
  if (key) {
    const g = await geocodeGoogle({ components: `locality:${poblacion}|country:ES` }, key, "forward");
    await registrarGoogle(ctx, "forward", g.result ? null : g.errorCode);
    const r = g.result?.find(
      (x) =>
        x.types.includes("locality") &&
        !x.partial_match &&
        municipiosCoinciden(localidadGoogle(x), poblacion),
    );
    const cpG = r ? componente(r, "postal_code") : null;
    if (cpG && /^\d{5}$/.test(cpG)) {
      const coherente = !provincia || provincesMatch(provincia, provinceFromPostalCode(cpG));
      if (coherente && (distintos.size === 0 || distintos.has(cpG))) return { cp: cpG, varios: false };
    }
  }
  if (distintos.size === 1) return { cp: [...distintos][0]!, varios: false };
  return { cp: null, varios: false };
}

// ─────────────────────────────────────────────────────────────────────
// Google
// ─────────────────────────────────────────────────────────────────────

/**
 * Resultado de una llamada a Google: o hay resultado, o hay un código
 * de error explicable. `errorCode` es el `status` de Google
 * (ZERO_RESULTS, REQUEST_DENIED, OVER_DAILY_LIMIT, INVALID_REQUEST…),
 * `http_<code>` si el HTTP no fue 2xx, o `fetch_failed` si ni
 * siquiera hubo respuesta. Se persiste en google_api_usage.error_code.
 */
type GoogleResult<T> =
  | { result: T; errorCode: null }
  | { result: null; errorCode: string };

interface ResultadoGoogle {
  formatted_address: string;
  types: string[];
  partial_match?: boolean;
  geometry: { location: { lat: number; lng: number } };
  address_components: Array<{ long_name: string; short_name: string; types: string[] }>;
}

function googleFailure<T>(
  endpoint: "reverse" | "forward",
  status: string,
  errorMessage?: string,
): GoogleResult<T> {
  // ZERO_RESULTS es normal (dirección inexistente); lo demás es un
  // problema de key/facturación/cuota y merece salir en los logs de Vercel.
  if (status !== "ZERO_RESULTS") {
    console.error(
      `[geocoding] Google ${endpoint} falló: ${status}${errorMessage ? ` — ${errorMessage}` : ""}`,
    );
  }
  return { result: null, errorCode: status };
}

function componente(r: ResultadoGoogle, tipo: string): string | null {
  return r.address_components.find((c) => c.types.includes(tipo))?.long_name ?? null;
}

function localidadGoogle(r: ResultadoGoogle): string | null {
  return (
    componente(r, "locality") ??
    componente(r, "postal_town") ??
    componente(r, "administrative_area_level_4") ??
    componente(r, "administrative_area_level_3")
  );
}

const TIPOS_GOOGLE_CASA = ["street_address", "premise", "subpremise"];

function googleEsExacto(
  r: ResultadoGoogle,
  pedido: { calle: string; numero: string; cp: string; poblacion: string },
): boolean {
  if (r.partial_match) return false;
  if (!r.types.some((t) => TIPOS_GOOGLE_CASA.includes(t))) return false;
  if (!callesParecidas(pedido.calle, componente(r, "route"))) return false;
  if (pedido.numero && /^\d/.test(pedido.numero) && !numerosCoinciden(pedido.numero, componente(r, "street_number"))) {
    return false;
  }
  if (pedido.poblacion) {
    const nombres = [
      componente(r, "locality"),
      componente(r, "postal_town"),
      componente(r, "administrative_area_level_3"),
      componente(r, "administrative_area_level_4"),
    ];
    return nombres.some((n) => municipiosCoinciden(n, pedido.poblacion));
  }
  return Boolean(pedido.cp) && componente(r, "postal_code") === pedido.cp;
}

async function geocodeGoogle(
  params: Record<string, string>,
  key: string,
  endpoint: "reverse" | "forward",
): Promise<GoogleResult<ResultadoGoogle[]>> {
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("language", "es");
    url.searchParams.set("region", "es");
    url.searchParams.set("key", key);
    const res = await fetch(url.toString(), { next: { revalidate: 60 } });
    if (!res.ok) return googleFailure(endpoint, `http_${res.status}`);
    const data = (await res.json()) as {
      status: string;
      error_message?: string;
      results?: ResultadoGoogle[];
    };
    if (data.status !== "OK" || !data.results?.length) {
      return googleFailure(endpoint, data.status || "empty", data.error_message);
    }
    return {
      result: data.results.map((r) => ({
        ...r,
        types: r.types ?? [],
        address_components: r.address_components ?? [],
      })),
      errorCode: null,
    };
  } catch {
    return googleFailure(endpoint, "fetch_failed");
  }
}

async function reverseGoogle(
  lat: number,
  lng: number,
  key: string,
): Promise<GoogleResult<ReverseGeocode>> {
  const g = await geocodeGoogle({ latlng: `${lat},${lng}` }, key, "reverse");
  if (!g.result) return g;
  const r = g.result[0]!;
  const route = componente(r, "route") ?? "";
  const { type, rest } = detectStreetType(route);
  return {
    result: {
      street_type: type,
      street: rest,
      street_number: componente(r, "street_number"),
      postal_code: componente(r, "postal_code"),
      city:
        componente(r, "locality") ??
        componente(r, "administrative_area_level_3") ??
        componente(r, "administrative_area_level_4") ??
        null,
      province:
        componente(r, "administrative_area_level_2") ??
        componente(r, "administrative_area_level_1") ??
        null,
      display_name: r.formatted_address,
    },
    errorCode: null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Nominatim
// ─────────────────────────────────────────────────────────────────────

const CABECERAS_NOMINATIM = {
  Accept: "application/json",
  "User-Agent": "Hidromanager-CRM/1.0 (contact@hidromanager.es)",
  "Accept-Language": "es-ES,es",
};

interface DireccionNominatim {
  road?: string;
  pedestrian?: string;
  residential?: string;
  cycleway?: string;
  path?: string;
  footway?: string;
  house_number?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  suburb?: string;
  city_district?: string;
  municipality?: string;
  province?: string;
  state?: string;
  county?: string;
}

function viaNominatim(a: DireccionNominatim): string {
  return a.road ?? a.pedestrian ?? a.residential ?? a.cycleway ?? a.path ?? a.footway ?? "";
}

async function reverseNominatim(
  lat: number,
  lng: number,
): Promise<ReverseGeocode | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=es&zoom=18`,
      { headers: CABECERAS_NOMINATIM, next: { revalidate: 60 } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { display_name?: string; address?: DireccionNominatim };
    if (!data.address) return null;
    const a = data.address;
    const { type, rest } = detectStreetType(viaNominatim(a));
    return {
      street_type: type,
      street: rest,
      street_number: a.house_number ?? null,
      postal_code: a.postcode ?? null,
      // Para España: preferir municipality / city / town antes que
      // suburb o village. Nominatim a veces devuelve `village=O Porto`
      // (barrio/parroquia) y nos quedaríamos sin el municipio real
      // (Ames). El orden correcto: ciudades grandes primero, luego
      // municipality (Ayuntamiento), y al final sub-localidades.
      city:
        a.city ??
        a.town ??
        a.municipality ??
        a.village ??
        a.hamlet ??
        a.city_district ??
        a.suburb ??
        null,
      // Para España: `county` es la provincia (A Coruña), `state` es
      // la comunidad autónoma (Galicia). Preferir county. `province`
      // existe en algunas regiones pero es raro.
      province: a.county ?? a.province ?? a.state ?? null,
      display_name: data.display_name ?? "",
    };
  } catch {
    return null;
  }
}

async function forwardNominatim(
  query: string,
  calleEsperada: string | null,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(query)}&countrycodes=es&limit=3`,
      { headers: CABECERAS_NOMINATIM, next: { revalidate: 60 } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string; address?: DireccionNominatim }>;
    // Mismo filtro que Google: un resultado con OTRA calle no vale.
    const ok = data.find((d) => {
      const via = d.address ? viaNominatim(d.address) : "";
      return !via || !calleEsperada || callesParecidas(calleEsperada, via);
    });
    if (!ok) return null;
    return { lat: parseFloat(ok.lat), lng: parseFloat(ok.lon) };
  } catch {
    return null;
  }
}

/** Búsqueda estructurada en Nominatim; solo vale si es esa casa en ese pueblo. */
async function nominatimExacto(pedido: {
  calle: string;
  numero: string;
  cp: string;
  poblacion: string;
}): Promise<DireccionResuelta | null> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("countrycodes", "es");
    url.searchParams.set("limit", "3");
    url.searchParams.set("street", `${pedido.numero} ${pedido.calle}`);
    if (pedido.poblacion) url.searchParams.set("city", pedido.poblacion);
    if (pedido.cp) url.searchParams.set("postalcode", pedido.cp);
    const res = await fetch(url.toString(), {
      headers: CABECERAS_NOMINATIM,
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string; address?: DireccionNominatim }>;
    for (const d of data) {
      const a = d.address;
      if (!a) continue;
      if (!callesParecidas(pedido.calle, viaNominatim(a))) continue;
      if (!numerosCoinciden(pedido.numero, a.house_number)) continue;
      const muni = [a.city, a.town, a.village, a.municipality, a.hamlet];
      const enSitio = pedido.poblacion
        ? muni.some((m) => municipiosCoinciden(m, pedido.poblacion))
        : Boolean(pedido.cp && a.postcode === pedido.cp);
      if (!enSitio) continue;
      const cpN = a.postcode ?? (pedido.cp || null);
      return {
        ok: true,
        exacta: true,
        fuente: "nominatim",
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lon),
        cp: cpN,
        poblacion: a.city ?? a.town ?? a.village ?? a.municipality ?? pedido.poblacion,
        provincia: provinciaPreferida(cpN, a.county ?? a.province ?? null),
        nombreEnMapa: [viaNominatim(a), a.house_number].filter(Boolean).join(" "),
      };
    }
    return null;
  } catch {
    return null;
  }
}
