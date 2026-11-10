import type { Metadata } from "next";

/**
 * Política de privacidad pública de Hidromanager (web y apps de iOS/Android).
 * La exigen App Store y Google Play. Ruta abierta en public-paths.ts.
 *
 * El contenido sale de una revisión del código del 2026-11-10 (servicios
 * externos y datos que se tratan). Si se añade un proveedor o un tipo de
 * dato nuevo, hay que actualizar esta página y la fecha.
 */

export const metadata: Metadata = {
  title: "Política de privacidad · Hidromanager",
  description: "Cómo trata Hidromanager los datos personales.",
};

const ACTUALIZADA = "10 de noviembre de 2026";

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-gray-900">{titulo}</h2>
      <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-gray-700">{children}</div>
    </section>
  );
}

export default function PrivacidadPage() {
  return (
    <main className="marco-px marco-pt marco-pb [--marco-pad:1rem] min-h-dvh bg-gray-50">
      <article className="mx-auto w-full max-w-2xl rounded-2xl border bg-white p-5 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold text-gray-900">Política de privacidad</h1>
        <p className="mt-1 text-sm text-gray-500">Actualizada el {ACTUALIZADA}</p>

        <p className="mt-6 text-[15px] leading-relaxed text-gray-700">
          Hidromanager es un programa de gestión (CRM) que usan las empresas de tratamiento de agua
          para trabajar con sus clientes. Se usa desde la web crm.hidromanager.es y desde las apps de
          iPhone y Android, que abren esa misma web.
        </p>

        <Seccion titulo="Quién trata tus datos">
          <p>
            <strong>La empresa que usa Hidromanager</strong> (la que te ha dado acceso, como empleado
            o como cliente) es la responsable de tus datos: decide qué guarda y para qué. Para
            cualquier petición sobre tus datos, dirígete primero a ella.
          </p>
          <p>
            <strong>Soluciones Vercomi SL</strong>, titular de Hidromanager y de sus apps, presta el
            servicio a esas empresas como encargada del tratamiento: guarda y procesa los datos por
            cuenta de ellas y siguiendo sus instrucciones. Dirección: C/ Hospital 2, piso 5, 46001
            Valencia. Correo: <a className="text-blue-700 underline" href="mailto:info@vercomi.com">info@vercomi.com</a>.
          </p>
        </Seccion>

        <Seccion titulo="Qué datos se tratan">
          <p>Según lo que use cada empresa, Hidromanager puede guardar:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>De sus clientes: nombre, DNI o NIF, dirección, teléfono, correo, equipos instalados, contratos, mantenimientos, incidencias, facturas y la cuenta bancaria para domiciliar recibos.</li>
            <li>De sus empleados: nombre, correo, foto de perfil, fichajes de jornada y, si la empresa lo configura, la dirección de su domicilio para planificar rutas.</li>
            <li>Firmas manuscritas en contratos, partes de instalación y mandatos SEPA.</li>
            <li>Fotos que se hacen con la cámara en instalaciones, contratos y gastos.</li>
            <li>Notas de voz que se graban con el micrófono en el chat interno.</li>
            <li>Ubicación del móvil en momentos concretos: al fichar, al empezar o terminar una instalación, al firmar un contrato o al guardar una dirección. Se toma solo en ese momento y con la app abierta; no hay seguimiento continuo ni en segundo plano.</li>
            <li>Si la empresa usa el agente de voz, la grabación y la transcripción de la llamada, que se borran pasado el plazo que fije la empresa (90 días por defecto).</li>
          </ul>
        </Seccion>

        <Seccion titulo="Para qué">
          <p>
            Para prestar el servicio que la empresa contrata con sus clientes (instalar y mantener
            equipos, gestionar contratos y cobros), para gestionar la jornada de sus empleados y para
            cumplir sus obligaciones legales, como las fiscales. Las comunicaciones comerciales solo
            se envían a quien ha dado su consentimiento, y cada una lleva un enlace para darse de baja.
          </p>
          <p>
            Hidromanager no muestra publicidad, no vende datos y no usa herramientas de analítica ni
            cookies de seguimiento. Solo usa las cookies necesarias para mantener la sesión iniciada.
            Los correos que envían las empresas pueden llevar una marca que indica si se han abierto.
          </p>
        </Seccion>

        <Seccion titulo="Con quién se comparten">
          <p>Con los proveedores que hacen falta para prestar el servicio, siempre por cuenta de la empresa:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Alojamiento y base de datos: Vercel y Supabase, con los servidores en París (Unión Europea).</li>
            <li>Envío de correos: Resend o el servidor de correo de la propia empresa.</li>
            <li>Mapas y direcciones: CartoCiudad (Gobierno de España), OpenStreetMap y Google Maps.</li>
            <li>Domiciliación de recibos: GoCardless, si la empresa lo usa. Hidromanager guarda solo los últimos dígitos de la cuenta cuando el mandato se gestiona allí.</li>
            <li>Mensajes de WhatsApp y llamadas del agente de voz: Twilio y ElevenLabs, si la empresa los activa.</li>
            <li>Lectura automática de tickets de gasto: Mindee, si la empresa lo activa.</li>
          </ul>
          <p>
            Algunos de estos proveedores están fuera de la Unión Europea. En ese caso, la transferencia
            se ampara en las garantías que ofrece cada uno, como las cláusulas contractuales tipo de la
            Comisión Europea o el Marco de Privacidad de Datos entre la UE y EE. UU.
          </p>
        </Seccion>

        <Seccion titulo="Cuánto tiempo">
          <p>
            Mientras dure la relación con la empresa y, después, el tiempo que obliguen las leyes (por
            ejemplo, los plazos fiscales y laborales). Cuando una empresa deja de usar Hidromanager,
            sus datos se borran o se le devuelven.
          </p>
        </Seccion>

        <Seccion titulo="Tus derechos y cómo borrar tu cuenta">
          <p>
            Puedes pedir el acceso a tus datos, corregirlos, borrarlos, limitar u oponerte a su uso y
            llevártelos. Las cuentas de Hidromanager no se crean desde la app: las crea tu empresa, así
            que para darte de baja o borrar tu cuenta pídeselo a ella. Si no sabes a quién dirigirte o
            no te contestan, escribe a{" "}
            <a className="text-blue-700 underline" href="mailto:info@vercomi.com">info@vercomi.com</a> y
            haremos llegar tu petición a la empresa.
          </p>
          <p>
            Si crees que no se han atendido bien tus derechos, puedes reclamar ante la Agencia Española
            de Protección de Datos (aepd.es).
          </p>
        </Seccion>

        <Seccion titulo="Permisos de las apps">
          <p>
            Las apps de iPhone y Android piden permiso para usar la cámara (fotos de los partes), la
            ubicación mientras se usan (fichajes y visitas), el micrófono (notas de voz) y las
            notificaciones. Puedes negarlos o retirarlos cuando quieras en los ajustes del móvil; la
            función que los necesita dejará de estar disponible.
          </p>
        </Seccion>
      </article>
    </main>
  );
}
