import { requireSesionPortal } from "@/modules/portal-clientes/sesion";
import { cargarDatosPortal } from "@/modules/portal-clientes/datos";

const TZ = "Europe/Madrid";

function fecha(v: string | null, conHora = false): string {
  if (!v) return "—";
  // Fechas sin hora (date) se pintan tal cual, sin desplazar por zona horaria.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-");
    return `${d}/${m}/${y}`;
  }
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(conHora ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(v));
}

function euros(cents: number | null): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

const TIPO_MANT: Record<string, string> = {
  contracted: "Mantenimiento",
  one_off: "Visita puntual",
  warranty: "Garantía",
};
const ESTADO_CONTRATO: Record<string, string> = {
  signed: "Firmado",
  active: "Vigente",
  completed: "Finalizado",
};
const ESTADO_INCIDENCIA: Record<string, string> = {
  open: "Abierta",
  assigned: "Asignada",
  in_progress: "En curso",
  waiting_parts: "Esperando piezas",
  waiting_customer: "Pendiente de ti",
  resolved: "Resuelta",
  closed: "Cerrada",
  cancelled: "Anulada",
};
const ESTADO_FACTURA: Record<string, string> = {
  issued: "Pendiente",
  paid: "Pagada",
  overdue: "Vencida",
};
const ESTADO_PLAN: Record<string, string> = {
  active: "Activo",
  paused: "En pausa",
  cancelled: "Cancelado",
  expired: "Caducado",
  pending: "Pendiente",
};

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

function Tarjeta({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border bg-white p-4 shadow-sm">{children}</div>;
}

function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed bg-white/60 p-4 text-sm text-muted-foreground">{children}</p>;
}

export default async function PortalInicioPage() {
  const sesion = await requireSesionPortal();
  const d = await cargarDatosPortal(sesion);
  const proximo = d.proximos_mantenimientos[0] ?? null;
  const incidenciasAbiertas = d.incidencias.filter(
    (i) => !["resolved", "closed", "cancelled"].includes(i.estado),
  );

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{d.empresa.nombre}</p>
        <h1 className="text-2xl font-semibold leading-tight">
          Hola{d.cliente.nombre ? `, ${d.cliente.nombre.split(" ")[0]}` : ""}
        </h1>
      </div>

      {/* Lo más útil arriba: la próxima visita. */}
      <Tarjeta>
        <p className="text-sm text-muted-foreground">Próxima visita</p>
        {proximo ? (
          <p className="mt-1 text-lg font-semibold">
            {fecha(proximo.fecha, true)}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              · {TIPO_MANT[proximo.tipo] ?? "Visita"}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-base">No tienes ninguna visita programada.</p>
        )}
        {(d.empresa.telefono || d.empresa.email) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {d.empresa.telefono && (
              <a
                href={`tel:${d.empresa.telefono.replace(/\s/g, "")}`}
                className="inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
              >
                Llamar a {d.empresa.nombre || "la empresa"}
              </a>
            )}
            {d.empresa.email && (
              <a
                href={`mailto:${d.empresa.email}`}
                className="inline-flex h-11 items-center rounded-lg border px-4 text-sm font-medium"
              >
                Escribir un correo
              </a>
            )}
          </div>
        )}
      </Tarjeta>

      <Seccion titulo="Tus equipos">
        {d.equipos.length === 0 ? (
          <Vacio>No tienes equipos registrados.</Vacio>
        ) : (
          <div className="space-y-3">
            {d.equipos.map((e) => (
              <Tarjeta key={e.id}>
                <p className="font-medium">{e.nombre}</p>
                {e.direccion && <p className="text-sm text-muted-foreground">{e.direccion}</p>}
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Instalado</dt>
                    <dd>{fecha(e.instalado_el)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Último mantenimiento</dt>
                    <dd>{fecha(e.ultimo_mantenimiento)}</dd>
                  </div>
                  {e.garantia_hasta && (
                    <div>
                      <dt className="text-muted-foreground">Garantía hasta</dt>
                      <dd>{fecha(e.garantia_hasta)}</dd>
                    </div>
                  )}
                  {e.numero_serie && (
                    <div>
                      <dt className="text-muted-foreground">N.º de serie</dt>
                      <dd className="break-all">{e.numero_serie}</dd>
                    </div>
                  )}
                </dl>
              </Tarjeta>
            ))}
          </div>
        )}
      </Seccion>

      {incidenciasAbiertas.length > 0 && (
        <Seccion titulo="Incidencias abiertas">
          <div className="space-y-3">
            {incidenciasAbiertas.map((i) => (
              <Tarjeta key={i.id}>
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">{i.titulo}</p>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                    {ESTADO_INCIDENCIA[i.estado] ?? i.estado}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {i.referencia ? `${i.referencia} · ` : ""}Abierta el {fecha(i.abierta_el)}
                </p>
              </Tarjeta>
            ))}
          </div>
        </Seccion>
      )}

      <Seccion titulo="Mantenimientos realizados">
        {d.mantenimientos_hechos.length === 0 ? (
          <Vacio>Todavía no hay mantenimientos realizados.</Vacio>
        ) : (
          <Tarjeta>
            <ul className="divide-y text-sm">
              {d.mantenimientos_hechos.map((m) => (
                <li key={m.id} className="flex justify-between py-2">
                  <span>{TIPO_MANT[m.tipo] ?? "Visita"}</span>
                  <span className="text-muted-foreground">{fecha(m.fecha)}</span>
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}
      </Seccion>

      {(d.contratos.length > 0 || d.planes_mantenimiento.length > 0) && (
        <Seccion titulo="Contratos">
          <div className="space-y-3">
            {d.contratos.map((c) => (
              <Tarjeta key={c.id}>
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">Contrato {c.referencia ?? ""}</p>
                  <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-900">
                    {ESTADO_CONTRATO[c.estado] ?? c.estado}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Firmado el {fecha(c.firmado_el)}
                  {c.cuota_cents ? ` · ${euros(c.cuota_cents)}/mes` : ""}
                </p>
              </Tarjeta>
            ))}
            {d.planes_mantenimiento.map((p) => (
              <Tarjeta key={p.id}>
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">Plan de mantenimiento {p.referencia ?? ""}</p>
                  {p.estado && (
                    <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-900">
                      {ESTADO_PLAN[p.estado] ?? p.estado}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Desde {fecha(p.desde)}
                  {p.hasta ? ` hasta ${fecha(p.hasta)}` : ""}
                  {p.cuota_cents ? ` · ${euros(p.cuota_cents)}/mes` : ""}
                  {p.visitas_anuales ? ` · ${p.visitas_anuales} visitas al año` : ""}
                </p>
              </Tarjeta>
            ))}
          </div>
        </Seccion>
      )}

      {d.facturas.length > 0 && (
        <Seccion titulo="Facturas">
          <Tarjeta>
            <ul className="divide-y text-sm">
              {d.facturas.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{f.referencia ?? "Factura"}</p>
                    <p className="text-muted-foreground">{fecha(f.fecha)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium tabular-nums">{euros(f.total_cents)}</p>
                    <p className={f.estado === "overdue" ? "text-destructive" : "text-muted-foreground"}>
                      {ESTADO_FACTURA[f.estado] ?? f.estado}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Tarjeta>
        </Seccion>
      )}
    </div>
  );
}
