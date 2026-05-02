"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser, Check } from "lucide-react";
import { Button } from "@/shared/ui/button";

interface Props {
  onConfirm: (dataUrl: string) => void | Promise<void>;
  height?: number;
  pending?: boolean;
}

/**
 * Componente táctil de firma. Captura trazo en canvas y entrega PNG dataURL.
 * Soporta touch (tablets) y mouse (escritorio).
 */
export function SignaturePad({ onConfirm, height = 240, pending = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [empty, setEmpty] = useState(true);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#202224";
  }, []);

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const ctx = canvas.getContext("2d")!;
    const { x, y } = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setEmpty(false);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = getPoint(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
  }

  function confirm() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    void onConfirm(dataUrl);
  }

  return (
    <div className="space-y-3">
      <div
        className="relative overflow-hidden rounded-2xl border-2 border-dashed border-border bg-card"
        style={{ height }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className="block h-full w-full touch-none"
          style={{ cursor: "crosshair" }}
        />
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Firma aquí con el dedo o ratón
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={clear} disabled={pending || empty}>
          <Eraser className="h-4 w-4" /> Borrar
        </Button>
        <Button variant="success" onClick={confirm} disabled={pending || empty}>
          <Check className="h-4 w-4" /> {pending ? "Guardando..." : "Confirmar firma"}
        </Button>
      </div>
    </div>
  );
}
