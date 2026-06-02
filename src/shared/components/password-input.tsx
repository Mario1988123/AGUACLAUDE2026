"use client";

import { forwardRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * Input de contraseña con botón ojo para mostrar/ocultar el texto.
 * API compatible con un <input> nativo. Sin librería externa.
 */
type Props = React.InputHTMLAttributes<HTMLInputElement>;

export const PasswordInput = forwardRef<HTMLInputElement, Props>(
  function PasswordInput({ className = "", ...props }, ref) {
    const [show, setShow] = useState(false);
    return (
      <div className="relative">
        <input
          ref={ref}
          type={show ? "text" : "password"}
          {...props}
          className={`flex h-12 w-full rounded-md border border-input bg-background px-3 pr-11 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute inset-y-0 right-2 flex w-9 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
          tabIndex={-1}
        >
          {show ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
    );
  },
);
