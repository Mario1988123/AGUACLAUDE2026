/**
 * Cliente AEAT — envía el SOAP envelope al servicio Verifactu de la
 * Agencia Tributaria usando mTLS con el certificado FNMT de la empresa.
 *
 * Endpoints oficiales:
 *  · Producción: https://www2.agenciatributaria.gob.es/wlpl/SSII-FACT/ws/RegFactuSistemaFacturacion
 *  · Pruebas:    https://www7.aeat.es/wlpl/SSII-FACT/ws/RegFactuSistemaFacturacion
 *
 * El certificado .p12 se descifra en memoria, se extrae la clave
 * privada + chain y se usa como `cert`/`key` en el agente HTTPS.
 */

import https from "node:https";
import forge from "node-forge";
import { decryptBuffer, decryptString } from "@/shared/lib/crypto/aes-gcm";

const ENDPOINT_PROD =
  "https://www2.agenciatributaria.gob.es/wlpl/SSII-FACT/ws/RegFactuSistemaFacturacion";
const ENDPOINT_TEST =
  "https://www7.aeat.es/wlpl/SSII-FACT/ws/RegFactuSistemaFacturacion";

export interface AeatSendResult {
  ok: boolean;
  status: "Correcto" | "AceptadoConErrores" | "Incorrecto" | "ErrorRed";
  csv: string | null;
  error_code: string | null;
  error_message: string | null;
  raw_response: string;
}

/**
 * Convierte el certificado .p12 cifrado en BD a PEM (cert + clave
 * privada) para usarlo en https.Agent.
 */
function unwrapCertificate(
  encryptedP12: Buffer,
  encryptedPasswordBase64: string,
): { certPem: string; keyPem: string; caPem: string } {
  const password = decryptString(encryptedPasswordBase64);
  const p12Buffer = decryptBuffer(encryptedP12);

  const p12Asn1 = forge.asn1.fromDer(
    forge.util.createBuffer(p12Buffer.toString("binary")),
  );
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

  // Cert del cliente
  const certOid = forge.pki.oids.certBag as string;
  const keyOid = forge.pki.oids.pkcs8ShroudedKeyBag as string;
  const certBags = p12.getBags({ bagType: certOid });
  const certBag = certBags[certOid]?.[0];
  if (!certBag?.cert) throw new Error("Certificado no encontrado en .p12");

  // Clave privada
  const keyBags = p12.getBags({ bagType: keyOid });
  const keyBag = keyBags[keyOid]?.[0];
  if (!keyBag?.key) throw new Error("Clave privada no encontrada en .p12");

  // Cadena (CA intermedia)
  const allCertBags = certBags[certOid] ?? [];
  const caCerts = allCertBags
    .slice(1)
    .map((b) => (b.cert ? forge.pki.certificateToPem(b.cert) : ""))
    .filter(Boolean);

  return {
    certPem: forge.pki.certificateToPem(certBag.cert),
    keyPem: forge.pki.privateKeyToPem(keyBag.key),
    caPem: caCerts.join("\n"),
  };
}

/**
 * Envía el SOAP envelope (ya firmado XAdES) al servicio AEAT.
 */
export async function sendToAeat(opts: {
  soapEnvelope: string;
  encryptedCert: Buffer;
  encryptedPassword: string;
  environment: "production" | "test" | "sandbox";
}): Promise<AeatSendResult> {
  const url =
    opts.environment === "production" ? ENDPOINT_PROD : ENDPOINT_TEST;

  let certPem: string;
  let keyPem: string;
  let caPem: string;
  try {
    ({ certPem, keyPem, caPem } = unwrapCertificate(
      opts.encryptedCert,
      opts.encryptedPassword,
    ));
  } catch (e) {
    return {
      ok: false,
      status: "ErrorRed",
      csv: null,
      error_code: "CERT_PARSE",
      error_message: e instanceof Error ? e.message : String(e),
      raw_response: "",
    };
  }

  const agent = new https.Agent({
    cert: certPem,
    key: keyPem,
    ca: caPem || undefined,
    rejectUnauthorized: true,
  });

  return new Promise<AeatSendResult>((resolve) => {
    const req = https.request(
      url,
      {
        method: "POST",
        agent,
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: '""',
          "Content-Length": Buffer.byteLength(opts.soapEnvelope, "utf-8"),
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          resolve(parseAeatResponse(body, res.statusCode ?? 0));
        });
      },
    );
    req.on("error", (e) => {
      resolve({
        ok: false,
        status: "ErrorRed",
        csv: null,
        error_code: "NETWORK",
        error_message: e.message,
        raw_response: "",
      });
    });
    req.setTimeout(30000, () => {
      req.destroy();
      resolve({
        ok: false,
        status: "ErrorRed",
        csv: null,
        error_code: "TIMEOUT",
        error_message: "Timeout 30s al contactar AEAT",
        raw_response: "",
      });
    });
    req.write(opts.soapEnvelope);
    req.end();
  });
}

/**
 * Parser básico de la respuesta SOAP de AEAT. Extrae el estado, CSV
 * y posibles errores. Suficiente para el flujo principal.
 */
function parseAeatResponse(xml: string, statusCode: number): AeatSendResult {
  if (statusCode >= 500) {
    return {
      ok: false,
      status: "ErrorRed",
      csv: null,
      error_code: `HTTP_${statusCode}`,
      error_message: "AEAT devolvió error 5xx",
      raw_response: xml,
    };
  }
  // Buscar EstadoEnvio
  const estadoMatch = xml.match(/<EstadoEnvio>([^<]+)<\/EstadoEnvio>/);
  const csvMatch = xml.match(/<CSV>([^<]+)<\/CSV>/);
  const codigoErrorMatch = xml.match(/<CodigoError>([^<]+)<\/CodigoError>/);
  const descErrorMatch = xml.match(
    /<DescripcionError(?:Registro)?>([^<]+)<\/DescripcionError(?:Registro)?>/,
  );
  const estado = estadoMatch?.[1] ?? "Incorrecto";
  const csv = csvMatch?.[1] ?? null;
  const errorCode = codigoErrorMatch?.[1] ?? null;
  const errorMsg = descErrorMatch?.[1] ?? null;

  return {
    ok: estado === "Correcto" || estado === "AceptadoConErrores",
    status: estado as AeatSendResult["status"],
    csv,
    error_code: errorCode,
    error_message: errorMsg,
    raw_response: xml,
  };
}
