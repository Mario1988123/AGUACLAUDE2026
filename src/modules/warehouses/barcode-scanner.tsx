"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, X, ScanLine, Search } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { notify } from "@/shared/hooks/use-toast";
import {
  findProductByBarcode,
  setProductBarcodeAction,
  type BarcodeProductMatch,
} from "./barcode-actions";

interface Props {
  /** Si se pasa, en lugar de mostrar resultado permite asociar el
   *  barcode escaneado a ese producto (modo "memorizar"). */
  associateToProductId?: string;
  onAssociated?: (barcode: string) => void;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Html5Qrcode?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Html5QrcodeScanType?: any;
  }
}

/** Carga html5-qrcode desde CDN (sin npm install). */
function loadHtml5Qrcode(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("SSR"));
    if (window.Html5Qrcode) return resolve();
    const s = document.createElement("script");
    s.src = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("No se pudo cargar el escáner"));
    document.head.appendChild(s);
  });
}

export function BarcodeScanner({ associateToProductId, onAssociated }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState("");
  const [match, setMatch] = useState<BarcodeProductMatch | null | "none">(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null);
  const containerId = "barcode-scanner-region";

  // Arranque/parada del escáner cámara
  useEffect(() => {
    if (!open) return;
    let stopped = false;
    async function start() {
      try {
        await loadHtml5Qrcode();
        if (stopped) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Html5Qrcode = (window as any).Html5Qrcode;
        const scanner = new Html5Qrcode(containerId);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 150 } },
          (decodedText: string) => {
            setCode(decodedText.trim());
            // Parar al detectar para evitar lecturas repetidas
            scanner.stop().catch(() => {});
          },
          () => {
            /* lecturas fallidas no son errores */
          },
        );
      } catch (e) {
        notify.error(
          "Cámara no disponible",
          e instanceof Error ? e.message : String(e),
        );
      }
    }
    void start();
    return () => {
      stopped = true;
      const s = scannerRef.current;
      if (s && s.isScanning) {
        s.stop().catch(() => {});
      }
    };
  }, [open]);

  async function lookup() {
    if (!code.trim()) {
      notify.warning("Introduce o escanea un código");
      return;
    }
    startTransition(async () => {
      const r = await findProductByBarcode(code.trim());
      setMatch(r ?? "none");
    });
  }

  function associate() {
    if (!associateToProductId) return;
    if (!code.trim()) {
      notify.warning("Introduce o escanea un código");
      return;
    }
    startTransition(async () => {
      const r = await setProductBarcodeAction(associateToProductId, code.trim());
      if (!r.ok) {
        notify.error("No se pudo asociar", r.error);
        return;
      }
      notify.success("Barcode memorizado");
      onAssociated?.(code.trim());
      setOpen(false);
      setCode("");
      setMatch(null);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <Camera className="h-4 w-4" />
        {associateToProductId ? "Asociar barcode" : "Escanear código"}
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b p-3">
              <h3 className="flex items-center gap-2 text-base font-bold">
                <ScanLine className="h-4 w-4" /> Escaneo de código
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <div
                id={containerId}
                className="aspect-video w-full overflow-hidden rounded-xl border bg-black"
              />
              <p className="text-xs text-muted-foreground">
                Apunta al código de barras del fabricante. También puedes
                escribirlo a mano debajo.
              </p>
              <div className="flex gap-2">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Barcode manual"
                />
                {associateToProductId ? (
                  <Button
                    onClick={associate}
                    disabled={pending}
                    variant="success"
                  >
                    {pending ? "Asociando..." : "Asociar"}
                  </Button>
                ) : (
                  <Button onClick={lookup} disabled={pending} className="gap-1">
                    <Search className="h-4 w-4" />
                    {pending ? "Buscando..." : "Buscar"}
                  </Button>
                )}
              </div>
              {match && match !== "none" && (
                <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-3 text-sm">
                  <div className="font-bold text-emerald-900">{match.name}</div>
                  <div className="text-xs text-emerald-800">
                    SKU: {match.sku ?? "—"} · Stock total:{" "}
                    <strong>{match.total_stock}</strong> ud
                  </div>
                </div>
              )}
              {match === "none" && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Ningún producto tiene asociado ese código. Ve a la ficha del
                  producto que corresponda y usa &quot;Asociar barcode&quot;.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
