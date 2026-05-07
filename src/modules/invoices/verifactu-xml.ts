/**
 * Generación XML del registro Verifactu según schema oficial AEAT.
 *
 * Schema: SuministroLR.xsd / RegistroFacturacionAlta + RegistroAnulacion
 * (Orden HAC/1177/2024 + actualizaciones).
 *
 * Produce un SOAP envelope listo para enviar a:
 *   https://www2.agenciatributaria.gob.es/wlpl/SSII-FACT/ws/RegFactuSistemaFacturacion
 * (producción) o:
 *   https://www7.aeat.es/wlpl/SSII-FACT/ws/RegFactuSistemaFacturacion
 * (preproducción / pruebas).
 *
 * Importante: este XML debe firmarse con XAdES-BES antes de enviar
 * (ver verifactu-sign.ts). Aquí solo lo construimos.
 */

export interface VerifactuRegistroAltaInput {
  // Identificación versión
  id_version: "1.0";

  // Emisor
  issuer_nif: string;
  issuer_name: string;

  // Factura
  series_code: string;
  invoice_number: number;
  invoice_type: string; // F1, F2, F3, R1-R5
  issued_at: Date;
  operation_date: Date;
  description: string;

  // Receptor
  recipient_nif?: string | null;
  recipient_name?: string | null;
  recipient_country?: string;
  /** ID type según AEAT: 02=NIF, 03=Pasaporte, 04=Documento oficial extranjero, 05=Certificado residencia, 06=Otro, 07=No censado */
  recipient_id_type?: string;

  // Importes (céntimos)
  base_total_cents: number;
  tax_total_cents: number;
  total_cents: number;

  // Desglose IVA (al menos uno)
  taxes: Array<{
    tax_rate: number;
    base_cents: number;
    tax_cents: number;
    is_exempt?: boolean;
    exempt_reason?: string;
  }>;

  // Cadena criptográfica
  prev_hash: string;
  current_hash: string;

  // Para rectificativas
  rectifies?: {
    series_code: string;
    invoice_number: number;
    rectification_type?: "S" | "I"; // S=sustitución, I=incremental
  } | null;
}

const eur = (cents: number): string => (cents / 100).toFixed(2);
const ddmmyyyy = (d: Date): string => {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
};
const isoNoMs = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const escapeXml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Construye el XML de RegistroFacturacionAlta. Devuelve string sin
 * declaración XML (que la añade el SOAP envelope).
 */
export function buildRegistroFacturacionAltaXml(
  input: VerifactuRegistroAltaInput,
): string {
  const fechaExp = ddmmyyyy(input.issued_at);
  const fechaOp = ddmmyyyy(input.operation_date);
  const totalImp = eur(input.total_cents);
  const baseTot = eur(input.base_total_cents);
  const cuotaTot = eur(input.tax_total_cents);

  // Desglose
  const desgloseXml = input.taxes
    .map((t) => {
      const base = eur(t.base_cents);
      const cuota = eur(t.tax_cents);
      if (t.is_exempt) {
        return `
        <DetalleDesglose>
          <Impuesto>01</Impuesto>
          <ClaveRegimen>01</ClaveRegimen>
          <CalificacionOperacion>S1</CalificacionOperacion>
          <OperacionExenta>${escapeXml(t.exempt_reason ?? "E1")}</OperacionExenta>
          <BaseImponibleOimporteNoSujeto>${base}</BaseImponibleOimporteNoSujeto>
        </DetalleDesglose>`;
      }
      return `
        <DetalleDesglose>
          <Impuesto>01</Impuesto>
          <ClaveRegimen>01</ClaveRegimen>
          <CalificacionOperacion>S1</CalificacionOperacion>
          <TipoImpositivo>${t.tax_rate.toFixed(2)}</TipoImpositivo>
          <BaseImponibleOimporteNoSujeto>${base}</BaseImponibleOimporteNoSujeto>
          <CuotaRepercutida>${cuota}</CuotaRepercutida>
        </DetalleDesglose>`;
    })
    .join("");

  // Receptor opcional (factura simplificada F2 puede no tenerlo)
  const recipientXml =
    input.recipient_nif && input.recipient_name
      ? `
      <Destinatarios>
        <IDDestinatario>
          <NombreRazon>${escapeXml(input.recipient_name)}</NombreRazon>
          <NIF>${escapeXml(input.recipient_nif)}</NIF>
        </IDDestinatario>
      </Destinatarios>`
      : "";

  // Rectificativa
  const rectificativaXml = input.rectifies
    ? `
      <FacturasRectificadas>
        <IDFacturaRectificada>
          <NumSerieFactura>${escapeXml(input.rectifies.series_code)}-${input.rectifies.invoice_number}</NumSerieFactura>
          <FechaExpedicionFactura>${fechaExp}</FechaExpedicionFactura>
        </IDFacturaRectificada>
      </FacturasRectificadas>
      <TipoRectificativa>${input.rectifies.rectification_type ?? "S"}</TipoRectificativa>`
    : "";

  return `<sum:RegistroAlta>
    <IDVersion>${input.id_version}</IDVersion>
    <IDFactura>
      <IDEmisorFactura>${escapeXml(input.issuer_nif)}</IDEmisorFactura>
      <NumSerieFactura>${escapeXml(input.series_code)}-${input.invoice_number}</NumSerieFactura>
      <FechaExpedicionFactura>${fechaExp}</FechaExpedicionFactura>
    </IDFactura>
    <NombreRazonEmisor>${escapeXml(input.issuer_name)}</NombreRazonEmisor>
    <TipoFactura>${input.invoice_type}</TipoFactura>
    ${rectificativaXml}
    <DescripcionOperacion>${escapeXml(input.description.slice(0, 500))}</DescripcionOperacion>
    ${recipientXml}
    <Desglose>${desgloseXml}
    </Desglose>
    <CuotaTotal>${cuotaTot}</CuotaTotal>
    <ImporteTotal>${totalImp}</ImporteTotal>
    <Encadenamiento>
      ${
        input.prev_hash
          ? `<RegistroAnterior>
        <IDEmisorFactura>${escapeXml(input.issuer_nif)}</IDEmisorFactura>
        <NumSerieFactura>${escapeXml(input.series_code)}-${input.invoice_number - 1}</NumSerieFactura>
        <FechaExpedicionFactura>${fechaExp}</FechaExpedicionFactura>
        <Huella>${escapeXml(input.prev_hash)}</Huella>
      </RegistroAnterior>`
          : `<PrimerRegistro>S</PrimerRegistro>`
      }
    </Encadenamiento>
    <SistemaInformatico>
      <NombreRazon>AGUACLAUDE CRM</NombreRazon>
      <NIF>${escapeXml(input.issuer_nif)}</NIF>
      <NombreSistemaInformatico>AGUACLAUDE</NombreSistemaInformatico>
      <IdSistemaInformatico>01</IdSistemaInformatico>
      <Version>1.0</Version>
      <NumeroInstalacion>0001</NumeroInstalacion>
      <TipoUsoPosibleSoloVerifactu>S</TipoUsoPosibleSoloVerifactu>
      <TipoUsoPosibleMultiOT>N</TipoUsoPosibleMultiOT>
      <IndicadorMultiplesOT>N</IndicadorMultiplesOT>
    </SistemaInformatico>
    <FechaHoraHusoGenRegistro>${isoNoMs(input.issued_at)}</FechaHoraHusoGenRegistro>
    <TipoHuella>01</TipoHuella>
    <Huella>${escapeXml(input.current_hash)}</Huella>
  </sum:RegistroAlta>`;
}

/**
 * SOAP envelope completo listo para enviar a AEAT.
 * Inserta el RegistroAlta firmado dentro del Body.
 */
export function buildSoapEnvelope(signedRegistroXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:sum="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroInformacion.xsd"
  xmlns:sum1="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroLR.xsd">
  <soapenv:Header/>
  <soapenv:Body>
    <sum:RegFactuSistemaFacturacion>
      <sum:Cabecera>
        <sum1:ObligadoEmision>
          <sum1:NombreRazon>EMPRESA</sum1:NombreRazon>
          <sum1:NIF>NIF_PLACEHOLDER</sum1:NIF>
        </sum1:ObligadoEmision>
      </sum:Cabecera>
      <sum:RegistroFactura>
        ${signedRegistroXml}
      </sum:RegistroFactura>
    </sum:RegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;
}
