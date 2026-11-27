import { cache } from "react";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Archivo, Courier_Prime } from "next/font/google";
import QRCode from "qrcode";
import { formatearTelefono } from "@/modules/products/ficha/modelo";
import { siteBaseUrl } from "@/shared/lib/site-url";
import {
  ACCION,
  cartaPorDefecto,
  derivarPaletaPropuesta,
  enlaceWaMe,
  estadoPropuesta,
  fechaCorta,
  fechaLarga,
  fechaSello,
  filasDatos,
  hayPrecios,
  NOTA_SIN_PRECIOS,
  referenciaDe,
  textoPedirActualizada,
  textoQueMeLlameis,
  TITULO_RELACION,
  type EstadoPropuesta,
  type LineaPropuesta,
} from "@/modules/captacion/propuesta-logica";
import {
  cargarEmpresaPropuesta,
  leerPropuestaPorCodigo,
  lineaFiscal,
  type EmpresaPropuesta,
  type FilaPropuesta,
} from "@/modules/captacion/propuesta-servidor";
import { Pulso } from "./pulso";
import s from "./propuesta.module.css";

/**
 * Página privada de la propuesta (docs/DISENO_PROPUESTA_CAPTACION.md §5).
 * Pública (sin sesión), noindex, sin cookies. Todo el contenido llega en el
 * HTML; JavaScript solo mide la visita y retira la barra fija. La apertura
 * NO se cuenta aquí: la vista previa de WhatsApp pide esta URL sin que nadie
 * la abra (plan §4.5).
 */

export const dynamic = "force-dynamic";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--f-archivo", display: "swap" });
const maquina = Courier_Prime({ subsets: ["latin"], weight: ["400", "700"], variable: "--f-maquina", display: "swap" });

const cargar = cache(async (codigo: string): Promise<{ prop: FilaPropuesta; empresa: EmpresaPropuesta } | null> => {
  const prop = await leerPropuestaPorCodigo(codigo);
  if (!prop) return null;
  const empresa = await cargarEmpresaPropuesta(prop.company_id);
  return empresa ? { prop, empresa } : null;
});

type Props = { params: Promise<{ codigo: string }> };

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // La página deja ampliar (la raíz del CRM no): quien agranda, agranda.
  maximumScale: 5,
  userScalable: true,
  colorScheme: "light",
  themeColor: "#f4f4f2",
};

/** «De la Vista Previa Muda»: lo mismo para válida, caducada y retirada. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { codigo } = await params;
  const datos = await cargar(codigo);
  const robots = { index: false, follow: false, nocache: true, noarchive: true, googleBot: { index: false, follow: false } };
  if (!datos) return { title: "No encontrada", robots, referrer: "no-referrer" };
  const titulo = `Propuesta de ${datos.empresa.nombre}`;
  const descripcion = "Enlace privado. Ábrelo para ver la propuesta.";
  const imagen = datos.empresa.logoUrl ? `/p/og/${datos.empresa.id}` : null;
  return {
    metadataBase: new URL(siteBaseUrl()),
    title: { absolute: titulo },
    description: descripcion,
    robots,
    referrer: "no-referrer",
    applicationName: null,
    manifest: null,
    appleWebApp: null,
    openGraph: {
      type: "website",
      title: titulo,
      description: descripcion,
      ...(imagen ? { images: [{ url: imagen, width: 1200, height: 630 }] } : {}),
    },
    twitter: { card: imagen ? "summary_large_image" : "summary", title: titulo, description: descripcion },
  };
}

// -----------------------------------------------------------------------------

function Membrete({ empresa }: { empresa: EmpresaPropuesta }) {
  return (
    <header className={s.membrete}>
      {empresa.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={s.logo} src={empresa.logoUrl} alt={empresa.nombre} referrerPolicy="no-referrer" />
      ) : (
        <span className={s.nombreEmpresa}>{empresa.nombre}</span>
      )}
    </header>
  );
}

function Sello({ estado, prop }: { estado: EstadoPropuesta; prop: FilaPropuesta }) {
  const fecha = estado === "revocada" ? prop.revocada_at! : prop.caduca_at;
  const arriba = estado === "valida" ? "Válida hasta" : estado === "caducada" ? "Caducada" : "Retirada";
  const etiqueta =
    estado === "valida"
      ? `Válida hasta el ${fechaLarga(fecha)}`
      : estado === "caducada"
        ? `Caducada el ${fechaLarga(fecha)}`
        : `Retirada el ${fechaLarga(fecha)}`;
  return (
    <p className={`${s.sello} ${estado === "valida" ? "" : s.selloApagado}`} aria-label={etiqueta} role="img">
      <span className={s.selloArriba} aria-hidden="true">
        {arriba}
      </span>
      <span className={s.selloAbajo} aria-hidden="true">
        {fechaSello(fecha)}
      </span>
    </p>
  );
}

function Casillas({ prop, estado }: { prop: FilaPropuesta; estado: EstadoPropuesta }) {
  const ref = referenciaDe(prop.codigo);
  if (estado === "revocada") {
    // Una revocación puede deberse a que se mandó a quien no era: ni nombre, ni fecha, ni referencia.
    return (
      <div className={s.selloSuelto}>
        <Sello estado={estado} prop={prop} />
      </div>
    );
  }
  const variables = [
    prop.tipo_negocio ? { r: "tipo de negocio", v: prop.tipo_negocio } : null,
    prop.localidad ? { r: "localidad", v: prop.localidad } : null,
  ].filter((x): x is { r: string; v: string } => !!x);
  return (
    <div className={s.casillas}>
      <div className={`${s.casilla} ${s.ancha}`}>
        <span className={s.rotulo}>propuesta para</span>
        <h1 className={s.negocio}>{prop.nombre_negocio}</h1>
      </div>
      {estado === "valida"
        ? variables.map((c) => (
            <div key={c.r} className={`${s.casilla} ${variables.length === 1 ? s.ancha : ""}`}>
              <span className={s.rotulo}>{c.r}</span>
              <span className={s.dato}>{c.v}</span>
            </div>
          ))
        : null}
      <div className={s.casilla}>
        <span className={s.rotulo}>fecha</span>
        <span className={s.dato}>{fechaCorta(prop.created_at)}</span>
        <span className={s.rotulo}>ref.</span>
        <span className={s.dato}>{ref}</span>
      </div>
      <div className={`${s.casilla} ${s.casillaSello}`}>
        <Sello estado={estado} prop={prop} />
      </div>
    </div>
  );
}

function Datos({ linea, conPrecios }: { linea: LineaPropuesta; conPrecios: boolean }) {
  const filas = filasDatos(linea, conPrecios);
  if (filas.length === 0) return null;
  return (
    <dl className={s.datos}>
      {filas.map((f) => (
        <div key={f.rotulo} style={{ display: "contents" }}>
          <dt>{f.rotulo}</dt>
          <dd>
            {f.valor}
            {f.leyenda ? <span className={s.leyenda}>{f.leyenda}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Foto({ linea, prioridad }: { linea: LineaPropuesta; prioridad: boolean }) {
  if (!linea.imagen_url) return null;
  return (
    <div className={s.foto} data-foto="">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={linea.imagen_url}
        alt={linea.nombre}
        loading={prioridad ? "eager" : "lazy"}
        fetchPriority={prioridad ? "high" : "auto"}
        decoding="async"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

function Partida({ linea, n, conPrecios }: { linea: LineaPropuesta; n: number; conPrecios: boolean }) {
  const principal = n === 1;
  const clase = `${s.partida} ${principal ? s.principal : s.compacta} ${linea.imagen_url ? "" : s.sinFoto}`;
  const titulo = (
    <div className={s.tituloPartida}>
      <span className={s.num}>{n}</span>
      <h3 className={principal ? s.nombrePrincipal : s.nombreCompacto}>{linea.nombre}</h3>
    </div>
  );
  const texto = (
    <>
      {titulo}
      {linea.lema ? <p className={s.lema}>{linea.lema}</p> : null}
      {linea.descripcion ? <p className={s.desc}>{linea.descripcion}</p> : null}
    </>
  );
  if (principal) {
    return (
      <li className={clase} data-partida="">
        <div className={s.fila}>
          <Foto linea={linea} prioridad />
          <div className={s.cuerpo}>
            {texto}
            <Datos linea={linea} conPrecios={conPrecios} />
          </div>
        </div>
      </li>
    );
  }
  return (
    <li className={clase} data-partida="">
      <div className={s.fila}>
        <Foto linea={linea} prioridad={false} />
        <div>{texto}</div>
        <Datos linea={linea} conPrecios={conPrecios} />
      </div>
    </li>
  );
}

function Telefono({ empresa }: { empresa: EmpresaPropuesta }) {
  const tel = formatearTelefono(empresa.telefono);
  if (!tel) return null;
  return (
    <p className={s.llamad}>
      o llamad vosotros:{" "}
      <a className={s.tel} href={`tel:${empresa.telefono!.replace(/[^\d+]/g, "")}`}>
        {tel}
      </a>
    </p>
  );
}

function Cupon({
  prop,
  empresa,
  waMe,
  id,
  clase,
  qr,
}: {
  prop: FilaPropuesta;
  empresa: EmpresaPropuesta;
  waMe: string | null;
  id?: string;
  clase?: string;
  qr?: string | null;
}) {
  const kb = prop.pdf_bytes ? Math.max(1, Math.round(prop.pdf_bytes / 1024)) : null;
  const paginas = prop.pdf_paginas ? `${prop.pdf_paginas} ${prop.pdf_paginas === 1 ? "página" : "páginas"}` : null;
  return (
    <section className={`${s.cupon} ${clase ?? ""}`} id={id} data-bloque="cupon" aria-labelledby={id ? `${id}-t` : undefined}>
      <h2 className={s.h2} id={id ? `${id}-t` : undefined}>
        ¿Lo vemos por teléfono?
      </h2>
      <p className={s.texto}>Pulsad el botón y se abre vuestro WhatsApp con el mensaje ya escrito. Os llamamos nosotros.</p>
      {waMe ? (
        <a className={s.boton} href={waMe} rel="noreferrer noopener">
          {ACCION}
        </a>
      ) : null}
      <Telefono empresa={empresa} />
      {qr ? (
        <div className={s.qr}>
          <div dangerouslySetInnerHTML={{ __html: qr }} />
          <span className={s.rotulo} style={{ marginTop: 8 }}>
            o escanead con el móvil
          </span>
        </div>
      ) : null}
      <p className={s.descarga}>
        <a className={s.enlace} href={`/p/${prop.codigo}/pdf`} rel="noreferrer">
          Descargar la propuesta en PDF
        </a>
        {paginas && kb ? <span className={s.dato}>{`${paginas} · ${kb} kB`}</span> : null}
      </p>
    </section>
  );
}

function Pie({ empresa }: { empresa: EmpresaPropuesta }) {
  return (
    <footer className={s.pie}>
      <p>
        <strong>{lineaFiscal(empresa)}</strong>
        {empresa.email ? ` ${empresa.email}` : null}
      </p>
      <p>Propuesta informativa, sin valor contractual. Las condiciones definitivas os las confirma un comercial.</p>
      <p>
        Esta página no usa cookies. Anotamos cuándo se abre la propuesta y cuánto se lee para saber si os ha interesado
        antes de llamaros. No guardamos vuestra dirección IP ni compartimos el dato con nadie.
      </p>
      <p>¿No queréis más mensajes? Contestad «baja» en el WhatsApp y no volvemos a escribir.</p>
      {empresa.urlPrivacidad ? (
        <p>
          <a href={empresa.urlPrivacidad} rel="noreferrer noopener">
            Privacidad
          </a>
        </p>
      ) : null}
    </footer>
  );
}

/** Filtro del sobreentintado del sello (§5.1). Si el navegador no lo aplica, el sello sale limpio. */
function FiltroTinta() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
      <filter id="sobreentintado">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" />
        <feDisplacementMap in="SourceGraphic" scale="1.5" />
      </filter>
    </svg>
  );
}

// -----------------------------------------------------------------------------

export default async function PaginaPropuesta({ params }: Props) {
  const { codigo } = await params;
  const datos = await cargar(codigo);
  if (!datos) notFound();
  const { prop, empresa } = datos;
  const estado = estadoPropuesta(prop);
  const ref = referenciaDe(prop.codigo);
  const p = derivarPaletaPropuesta(empresa.primario, empresa.acento);
  const vars = {
    "--mesa": p.mesa,
    "--hoja": p.hoja,
    "--hoja-debajo": p.hojaDebajo,
    "--velo": p.velo,
    "--filete": p.filete,
    "--tinta": p.tinta,
    "--tinta-suave": p.tintaSuave,
    "--trazo": p.trazo,
    "--campo": p.primarioCampo,
    "--sobre-campo": p.sobreCampo,
    "--campo-hover": p.campoHover,
  } as React.CSSProperties;
  const fuentes = `${archivo.variable} ${maquina.variable}`;

  // --- Caducada o retirada: una sola hoja y «Pedir una actualizada» ---------
  if (estado !== "valida") {
    const waMe = enlaceWaMe(empresa.numeroCaptacion, textoPedirActualizada(estado, prop.nombre_negocio, ref));
    // Ni los equipos ni (en la retirada) el negocio pasan a los componentes:
    // así no pueden salir en el HTML por ningún camino.
    const visible: FilaPropuesta = {
      ...prop,
      lineas: [],
      carta: null,
      que_incluye: [],
      ...(estado === "revocada" ? { nombre_negocio: "", tipo_negocio: null, localidad: null, prospecto_id: null, campana_id: null } : {}),
    };
    return (
      <div className={`${s.raiz} ${s.sinBarra} ${fuentes}`} style={vars}>
        <FiltroTinta />
        <div className={s.marco}>
          <main className={s.columna}>
            <article className={s.hoja}>
              <Membrete empresa={empresa} />
              <Casillas prop={visible} estado={estado} />
              <p className={s.aviso}>
                {estado === "caducada"
                  ? `Esta propuesta caducó el ${fechaLarga(prop.caduca_at)}. Los equipos y las condiciones pueden haber cambiado.`
                  : "Esta propuesta ya no está disponible. Si os sigue interesando, pedidnos otra y os la mandamos por WhatsApp."}
              </p>
              {waMe ? (
                <a className={s.boton} href={waMe} rel="noreferrer noopener">
                  Pedir una actualizada
                </a>
              ) : null}
              <Telefono empresa={empresa} />
            </article>
          </main>
        </div>
        <Pie empresa={empresa} />
        {/* La caducada también se mide (solo segundos): que vuelva es una señal. */}
        {estado === "caducada" ? <Pulso codigo={prop.codigo} /> : null}
        <div className={s.fibra} aria-hidden="true" />
      </div>
    );
  }

  // --- Válida ---------------------------------------------------------------
  const lineas = prop.lineas.slice(0, 6);
  const conPrecios = hayPrecios(lineas, prop.con_precios);
  const waMe = enlaceWaMe(empresa.numeroCaptacion, textoQueMeLlameis(prop.nombre_negocio, ref));
  const qr = waMe
    ? await QRCode.toString(waMe, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: p.tinta, light: "#0000" } })
    : null;
  const carta = prop.carta ?? cartaPorDefecto(lineas.length);

  return (
    <div className={`${s.raiz} ${fuentes}`} style={vars}>
      <FiltroTinta />
      <div className={s.marco}>
        <main className={s.columna}>
          <article className={`${s.hoja} ${s.debajo}`}>
            <Membrete empresa={empresa} />
            <Casillas prop={prop} estado={estado} />
            <div className={s.carta}>
              <p>Hola:</p>
              <p>{carta}</p>
              <p className={s.firma}>El equipo de {empresa.nombre}</p>
            </div>
          </article>

          <article className={s.hoja} data-bloque="equipos" aria-labelledby="equipos-t">
            <header className={s.relacionCab}>
              <h2 className={s.h2} id="equipos-t">
                {TITULO_RELACION(lineas.length)}
              </h2>
              <span className={s.cuenta} aria-label={`${lineas.length} ${lineas.length === 1 ? "equipo" : "equipos"}`}>
                {lineas.length}
              </span>
            </header>
            <ol className={s.partidas}>
              {lineas.map((l, i) => (
                <Partida key={`${l.product_id}-${i}`} linea={l} n={i + 1} conPrecios={conPrecios} />
              ))}
            </ol>
            {conPrecios ? null : <p className={s.nota}>{NOTA_SIN_PRECIOS}</p>}
            {prop.que_incluye.length > 0 ? (
              <section className={s.incluye} aria-labelledby="incluye-t">
                <h2 className={s.h2} id="incluye-t">
                  Qué incluye
                </h2>
                <ul>
                  {prop.que_incluye.map((x) => (
                    <li key={x}>— {x}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            <div className={`${s.cuponFinal}`}>
              <div className={s.corte} aria-hidden="true" />
              <Cupon prop={prop} empresa={empresa} waMe={waMe} id="cupon" />
            </div>
          </article>
        </main>

        <aside className={s.lateral} aria-label="Respuesta">
          <div className={s.hoja}>
            <Cupon prop={prop} empresa={empresa} waMe={waMe} qr={qr} />
          </div>
        </aside>
      </div>

      <Pie empresa={empresa} />

      {waMe ? (
        <div className={s.barra} id="barra" data-oculta="0">
          <a className={s.boton} href={waMe} rel="noreferrer noopener">
            {ACCION}
          </a>
        </div>
      ) : null}
      <Pulso codigo={prop.codigo} />
      <div className={s.fibra} aria-hidden="true" />
    </div>
  );
}
