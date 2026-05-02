"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { markAsRead } from "./actions";

export function MarkReadButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() =>
        startTransition(async () => {
          await markAsRead(id);
          router.refresh();
        })
      }
      disabled={pending}
      aria-label="Marcar leída"
    >
      <Check className="h-4 w-4" />
    </Button>
  );
}
