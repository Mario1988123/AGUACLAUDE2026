"use client";

/**
 * Lógica compartida de dirección + mapa para el alta de lead
 * (`modules/leads/create-form.tsx`) y la dirección de cliente
 * (`modules/addresses/address-form.tsx`). Cada formulario guarda sus campos
 * a su manera; el hook solo lee `valores` y devuelve parches con `aplicar`.
 *
 * Reglas:
 *  · Al escribir calle/número/CP/población (debounce) o salir de Población →
 *    `resolverDireccionAction`. Si es exacta fija la chincheta; si no, centra
 *    el mapa en la calle o el pueblo (coordenadas APROXIMADAS, no valen para
 *    guardar). Sin calle → `cpDePoblacionAction` para el CP.
 *  · Guardar con calle y sin coordenadas exactas no da el error rojo: centra
 *    el mapa, pide mover la chincheta y no guarda hasta que la mueva.
 *  · Chincheta → reverse (CartoCiudad primero). Si la calle la escribió el
 *    usuario, no se tocan calle ni número: solo CP/población/provincia vacíos
 *    o puestos por la app, y avisa de cómo la llama el mapa.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@/shared/hooks/use-toast";
import type { PlacesAddress } from "@/shared/components/places-autocomplete";
import {
  cpDePoblacionAction,
  resolverDireccionAction,
  reverseGeocodeAction,
  type DireccionResuelta,
} from "./actions";
import {
  lookupMunicipalitiesByPostalCode,
  type MunicipalityHit,
} from "./municipalities";
import {
  claveDireccion,
  parcheDesdeReverse,
  separarDireccion,
  type CampoAuto,
  type CamposDireccion,
} from "./direccion-texto";
import { detectStreetType } from "./street-type";
import {
  provinceFromPostalCode,
  validateSpanishPostalCode,
} from "@/shared/lib/validations/spanish";

export type GeoSource = "user_pin" | "user_location" | "geocoded" | null;

export interface ValoresDireccion extends CamposDireccion {
  lat: number | null;
  lng: number | null;
}

export interface ParcheDireccion extends Partial<CamposDireccion> {
  lat?: number | null;
  lng?: number | null;
  geo_source?: GeoSource;
}

/** De dónde salen las coordenadas actuales. Solo "exacta" y "usuario" valen para guardar. */
export type OrigenCoords = "ninguna" | "exacta" | "aproximada" | "usuario";

const AVISO_CHINCHETA =
  "No encontramos esa calle en el mapa: arrastra la chincheta hasta la casa (o pulsa en el mapa sobre ella).";
const AVISO_SIN_NUMERO =
  "Hemos encontrado la calle pero no ese número: arrastra la chincheta hasta la casa (o pulsa en el mapa sobre ella).";
const AVISO_SIN_MAPA =
  "No encontramos esa dirección en el mapa: pulsa en el mapa sobre la casa para colocar la chincheta.";
const DEBOUNCE_MS = 1200;

interface Opciones {
  valores: ValoresDireccion;
  aplicar: (p: ParcheDireccion) => void;
  /** Qué rellena la chincheta cuando la calle NO es manual: "todo" (lead) o "huecos". */
  modoChincheta: "todo" | "huecos";
}

export function useDireccion({ valores, aplicar, modoChincheta }: Opciones) {
  const valoresRef = useRef(valores);
  valoresRef.current = valores;
  const aplicarRef = useRef(aplicar);
  aplicarRef.current = aplicar;

  const tieneCoordsIniciales = valores.lat != null && valores.lng != null;
  const [origen, setOrigenEstado] = useState<OrigenCoords>(tieneCoordsIniciales ? "usuario" : "ninguna");
  const origenRef = useRef<OrigenCoords>(origen);
  const setOrigen = (o: OrigenCoords) => {
    origenRef.current = o;
    setOrigenEstado(o);
  };
  // Clave (calle|nº|CP|población) de la última resolución: evita repetir
  // llamadas y saber si las coordenadas son de la dirección actual.
  const claveResueltaRef = useRef(claveDireccion(valores));
  // La calle actual la tecleó el usuario (no viene de sugerencia ni del mapa).
  // Al editar una dirección guardada, lo que hay se trata como suyo.
  const calleManualRef = useRef(Boolean(valores.calle.trim()));
  // CP/población/provincia que puso la app (se pueden corregir con el mapa).
  const autosRef = useRef(new Set<CampoAuto>());

  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [pistaCp, setPistaCp] = useState<string | null>(null);
  const [usaCartociudad, setUsaCartociudad] = useState(false);
  const [municipiosDelCp, setMunicipiosDelCp] = useState<MunicipalityHit[]>([]);
  const mapaRef = useRef<HTMLDivElement | null>(null);

  const verMapa = () => {
    mapaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /** Rellena CP/población/provincia solo si están vacíos; los marca como automáticos. */
  const completarHuecos = (
    v: ValoresDireccion,
    datos: { cp?: string | null; poblacion?: string | null; provincia?: string | null },
  ): ParcheDireccion => {
    const p: ParcheDireccion = {};
    if (datos.cp && !v.cp.trim()) {
      p.cp = datos.cp;
      autosRef.current.add("cp");
    }
    if (datos.poblacion && !v.poblacion.trim()) {
      p.poblacion = datos.poblacion;
      autosRef.current.add("poblacion");
    }
    const prov = datos.provincia ?? (datos.cp ? provinceFromPostalCode(datos.cp) : null);
    if (prov && !v.provincia.trim()) {
      p.provincia = prov;
      autosRef.current.add("provincia");
    }
    return p;
  };

  const resolver = useCallback(
    async (
      motivo: "auto" | "boton" | "guardar",
      override?: ValoresDireccion,
    ): Promise<DireccionResuelta | null> => {
      const v = override ?? valoresRef.current;
      const clave = claveDireccion(v);
      const cp = validateSpanishPostalCode(v.cp) ? v.cp.trim() : "";
      if (!v.poblacion.trim() && !cp) {
        if (motivo === "boton") notify.warning("Escribe al menos calle y población");
        return null;
      }
      claveResueltaRef.current = clave;

      // Sin calle: lo único útil es el CP de la población.
      if (!v.calle.trim()) {
        if (cp || !v.poblacion.trim()) return null;
        const r = await cpDePoblacionAction(v.poblacion, v.provincia || null);
        if (claveDireccion(valoresRef.current) !== clave) return null;
        if (r.cp) {
          aplicarRef.current(completarHuecos(valoresRef.current, { cp: r.cp }));
          setPistaCp(null);
        } else {
          setPistaCp(r.varios ? `${v.poblacion.trim()} tiene varios códigos postales: escribe el de la casa.` : null);
        }
        return null;
      }

      setBuscando(true);
      let r: DireccionResuelta;
      try {
        r = await resolverDireccionAction({
          calle: v.calle,
          numero: v.numero,
          cp: cp || null,
          poblacion: v.poblacion,
          provincia: v.provincia || null,
        });
      } catch {
        setBuscando(false);
        if (motivo !== "auto") notify.warning("El servicio de mapas no respondió", "Coloca la chincheta en el mapa.");
        return null;
      }
      setBuscando(false);
      // El usuario siguió escribiendo: esta respuesta ya no es de su dirección.
      if (motivo === "auto" && claveDireccion(valoresRef.current) !== clave) return null;

      const actual = valoresRef.current;
      const parche = completarHuecos(actual, r);
      setPistaCp(null);
      setNota(null);
      const pinDelUsuario = origenRef.current === "usuario";

      if (r.exacta && r.lat != null && r.lng != null) {
        if (!pinDelUsuario || motivo !== "auto") {
          Object.assign(parche, { lat: r.lat, lng: r.lng, geo_source: "geocoded" as GeoSource });
          setOrigen("exacta");
        }
        setAviso(null);
        setUsaCartociudad(r.fuente === "cartociudad");
        aplicarRef.current(parche);
        if (motivo === "boton") notify.success("Localizado en el mapa", r.nombreEnMapa ?? undefined);
        return r;
      }

      // No exacta: si la chincheta la puso el usuario, no la movemos.
      if (!pinDelUsuario) {
        if (r.lat != null && r.lng != null) {
          Object.assign(parche, { lat: r.lat, lng: r.lng, geo_source: null as GeoSource });
          setOrigen("aproximada");
          setAviso(r.nombreEnMapa ? AVISO_SIN_NUMERO : AVISO_CHINCHETA);
          setUsaCartociudad(r.fuente === "cartociudad");
        } else {
          if (origenRef.current === "exacta") setOrigen("aproximada");
          setAviso(AVISO_SIN_MAPA);
        }
        if (motivo === "boton") notify.warning("No encontramos esa calle en el mapa", "Arrastra la chincheta hasta la casa.");
      }
      aplicarRef.current(parche);
      return r;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Resolución automática con debounce al cambiar calle/nº/CP/población.
  const clave = claveDireccion(valores);
  useEffect(() => {
    if (clave === claveResueltaRef.current) return;
    if (origenRef.current === "usuario") return; // chincheta/GPS del usuario mandan
    const v = valoresRef.current;
    if (v.poblacion.trim().length < 2 && !validateSpanishPostalCode(v.cp)) return;
    const t = setTimeout(() => {
      void resolver("auto");
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [clave, resolver]);

  // CP → municipios (catálogo local; Nominatim si está vacío). Con uno solo
  // y Población vacía, se rellena.
  const cpActual = valores.cp.trim();
  useEffect(() => {
    if (cpActual.length !== 5 || !validateSpanishPostalCode(cpActual)) {
      setMunicipiosDelCp([]);
      return;
    }
    let cancelado = false;
    (async () => {
      const lista = await lookupMunicipalitiesByPostalCode(cpActual).catch(() => []);
      if (cancelado) return;
      setMunicipiosDelCp(lista);
      if (lista.length === 1) {
        const unico = lista[0]!;
        aplicarRef.current(
          completarHuecos(valoresRef.current, { poblacion: unico.municipality, provincia: unico.province || null }),
        );
      }
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpActual]);

  /** Llamar en el onChange de cada campo que teclea el usuario. */
  const marcarEscrito = useCallback((campo: keyof CamposDireccion) => {
    if (campo === "calle") calleManualRef.current = true;
    if (campo === "cp" || campo === "poblacion" || campo === "provincia") autosRef.current.delete(campo);
  }, []);

  /** onBlur de Población: resolver ya, sin esperar al debounce. */
  const alSalirPoblacion = useCallback(() => {
    const v = valoresRef.current;
    if (claveDireccion(v) === claveResueltaRef.current) return;
    if (origenRef.current === "usuario") return;
    void resolver("auto");
  }, [resolver]);

  /** Botón «Buscar por dirección». */
  const buscarAhora = useCallback(() => resolver("boton"), [resolver]);

  /** Sugerencia elegida en PlacesAutocomplete. */
  const alElegirSugerencia = useCallback((addr: PlacesAddress) => {
    const v = valoresRef.current;
    const p: ParcheDireccion = {};
    if (addr.street) {
      const { type, rest } = detectStreetType(addr.street);
      p.street_type = type;
      p.calle = rest || addr.street;
    }
    if (addr.street_number) p.numero = addr.street_number;
    if (addr.postal_code) p.cp = addr.postal_code;
    if (addr.city) p.poblacion = addr.city;
    if (addr.province) p.provincia = addr.province;
    p.lat = addr.lat;
    p.lng = addr.lng;
    p.geo_source = "geocoded";
    calleManualRef.current = false;
    autosRef.current.clear();
    const fusion = { ...v, ...p } as ValoresDireccion;
    claveResueltaRef.current = claveDireccion(fusion);
    setUsaCartociudad(false);
    setNota(null);
    setPistaCp(null);
    // Una sugerencia sin número es la calle entera, no la casa.
    if (fusion.calle.trim() && !addr.street_number) {
      setOrigen("aproximada");
      setAviso(AVISO_CHINCHETA);
    } else {
      setOrigen("exacta");
      setAviso(null);
    }
    aplicarRef.current(p);
    notify.success("Dirección rellenada", addr.formatted);
  }, []);

  /** «No aparece: escribirla a mano»: separa el texto y lo vuelca a los campos. */
  const alEscribirManual = useCallback(
    (texto: string) => {
      const s = separarDireccion(texto);
      if (!s.calle) return;
      const v = valoresRef.current;
      const { type, rest } = detectStreetType(s.calle);
      const p: ParcheDireccion = { street_type: type, calle: rest || s.calle, numero: s.numero };
      if (s.cp) p.cp = s.cp;
      if (s.poblacion) p.poblacion = s.poblacion;
      if (s.provincia) p.provincia = s.provincia;
      else if (s.cp && provinceFromPostalCode(s.cp)) p.provincia = provinceFromPostalCode(s.cp)!;
      calleManualRef.current = true;
      for (const c of ["cp", "poblacion", "provincia"] as const) if (p[c]) autosRef.current.delete(c);
      // Las coordenadas que hubiera eran de otra dirección.
      if (origenRef.current !== "usuario") {
        p.lat = null;
        p.lng = null;
        p.geo_source = null;
        setOrigen("ninguna");
      }
      aplicarRef.current(p);
      const fusion = { ...v, ...p } as ValoresDireccion;
      if (fusion.poblacion.trim() || validateSpanishPostalCode(fusion.cp)) {
        void resolver("boton", fusion);
      } else {
        notify.info("Calle copiada a los campos", "Escribe la población para buscarla en el mapa.");
      }
    },
    [resolver],
  );

  /** GPS («Usar mi ubicación») o chincheta movida/pulsada en el mapa. */
  const desdeCoordenadas = useCallback(
    async (lat: number, lng: number, desde: "gps" | "chincheta") => {
      aplicarRef.current({ lat, lng, geo_source: desde === "gps" ? "user_location" : "user_pin" });
      setOrigen("usuario");
      setAviso(null);
      const rev = await reverseGeocodeAction(lat, lng);
      if (!rev) {
        notify.warning("Coordenadas capturadas", "El servicio de mapas no respondió. Rellena la calle a mano.");
        return;
      }
      const v = valoresRef.current;
      const respetarCalle = desde === "chincheta" && calleManualRef.current && Boolean(v.calle.trim());
      const { parche, nombreEnMapa, rellenados } = parcheDesdeReverse(rev, v, {
        modo: desde === "gps" ? "todo" : modoChincheta,
        respetarCalle,
        autos: autosRef.current,
      });
      for (const c of ["cp", "poblacion", "provincia"] as const) if (parche[c]) autosRef.current.add(c);
      if (parche.calle) calleManualRef.current = false;
      claveResueltaRef.current = claveDireccion({ ...v, ...parche });
      setUsaCartociudad(rev.fuente === "cartociudad");
      setPistaCp(null);
      aplicarRef.current(parche);
      if (nombreEnMapa) {
        setNota(`El mapa la llama «${nombreEnMapa}». Mantenemos la calle que escribiste.`);
        notify.info("Chincheta colocada", `El mapa la llama «${nombreEnMapa}».`);
      } else {
        setNota(null);
        if (respetarCalle) notify.success("Chincheta colocada");
        else if (rellenados.length === 0) notify.success("Chincheta colocada", "No se pudo leer la dirección de ese punto.");
        else if (!rev.street) notify.success("Dirección parcial", `Rellenado ${rellenados.join(", ")}. Escribe la calle a mano.`);
        else notify.success(desde === "gps" ? "Dirección detectada y aplicada" : "Dirección autorrellenada");
      }
    },
    [modoChincheta],
  );

  /**
   * Antes de guardar. `requiereCoords`: la dirección se va a guardar con
   * calle, así que hacen falta coordenadas de la casa. Devuelve las
   * coordenadas a enviar, o null si hay que esperar a la chincheta (ya avisa).
   */
  const prepararGuardado = useCallback(
    async (requiereCoords: boolean): Promise<{ lat: number | null; lng: number | null } | null> => {
      const v = valoresRef.current;
      const valen = (o: OrigenCoords) => o === "exacta" || o === "usuario";
      if (!requiereCoords) {
        return valen(origenRef.current) ? { lat: v.lat, lng: v.lng } : { lat: null, lng: null };
      }
      const alDia = claveDireccion(v) === claveResueltaRef.current;
      if (v.lat != null && v.lng != null && (origenRef.current === "usuario" || (origenRef.current === "exacta" && alDia))) {
        return { lat: v.lat, lng: v.lng };
      }
      if (!alDia || origenRef.current === "ninguna") {
        const r = await resolver("guardar");
        if (r?.exacta && r.lat != null && r.lng != null) return { lat: r.lat, lng: r.lng };
        if (origenRef.current === "usuario" && valoresRef.current.lat != null) {
          return { lat: valoresRef.current.lat, lng: valoresRef.current.lng };
        }
      }
      setAviso((a) => (origenRef.current === "aproximada" ? (a ?? AVISO_CHINCHETA) : AVISO_SIN_MAPA));
      notify.warning("Falta colocar la chincheta", "Arrástrala hasta la casa y vuelve a guardar.");
      verMapa();
      return null;
    },
    [resolver],
  );

  const borrarUbicacion = useCallback(() => {
    aplicarRef.current({ lat: null, lng: null, geo_source: null });
    setOrigen("ninguna");
    setAviso(null);
    setNota(null);
    claveResueltaRef.current = claveDireccion(valoresRef.current);
  }, []);

  return {
    buscando,
    aviso,
    nota,
    pistaCp,
    usaCartociudad,
    origen,
    municipiosDelCp,
    mapaRef,
    marcarEscrito,
    alSalirPoblacion,
    buscarAhora,
    alElegirSugerencia,
    alEscribirManual,
    desdeCoordenadas,
    prepararGuardado,
    borrarUbicacion,
  };
}

export type EstadoDireccion = ReturnType<typeof useDireccion>;
