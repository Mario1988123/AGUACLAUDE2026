"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, CheckCircle2, Send, XCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { changePostStatus, deleteSocialPost } from "./actions";

interface Props {
  postId: string;
  currentStatus: string;
}

export function PostStatusButtons({ postId, currentStatus }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function move(newStatus: "review" | "approved" | "published" | "draft" | "cancelled") {
    startTransition(async () => {
      const r = await changePostStatus(postId, newStatus);
      if (!r.ok) {
        notify.error("No se pudo cambiar el estado", r.error);
        return;
      }
      notify.success(`Estado: ${newStatus}`);
      router.refresh();
    });
  }

  function remove() {
    if (!confirm("¿Borrar esta publicación?")) return;
    startTransition(async () => {
      const r = await deleteSocialPost(postId);
      if (!r.ok) {
        notify.error("No se pudo borrar", r.error);
        return;
      }
      notify.success("Publicación borrada");
      router.push("/rrss/posts" as never);
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {currentStatus === "draft" && (
        <Button onClick={() => move("review")} disabled={pending} size="sm" variant="outline">
          <Eye className="h-3 w-3" /> Pasar a revisión
        </Button>
      )}
      {currentStatus === "review" && (
        <Button onClick={() => move("approved")} disabled={pending} size="sm" variant="success">
          <CheckCircle2 className="h-3 w-3" /> Aprobar
        </Button>
      )}
      {currentStatus === "approved" && (
        <Button onClick={() => move("published")} disabled={pending} size="sm">
          <Send className="h-3 w-3" /> Marcar publicado
        </Button>
      )}
      {currentStatus !== "draft" && currentStatus !== "published" && (
        <Button onClick={() => move("draft")} disabled={pending} size="sm" variant="outline">
          Volver a borrador
        </Button>
      )}
      {currentStatus !== "published" && (
        <Button onClick={remove} disabled={pending} size="sm" variant="destructive">
          <XCircle className="h-3 w-3" /> Borrar
        </Button>
      )}
    </div>
  );
}
