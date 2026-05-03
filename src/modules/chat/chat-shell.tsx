"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Megaphone,
  Users,
  User as UserIcon,
  Send,
  Plus,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { cn } from "@/shared/lib/utils";
import {
  getChatMessages,
  markChatThreadRead,
  sendChatMessageAction,
  createBroadcastThreadAction,
  createTeamThreadAction,
  getOrCreateDirectThreadAction,
  type ChatMessageRow,
  type ChatThreadRow,
  type DirectoryUser,
} from "./actions";

interface Props {
  threads: ChatThreadRow[];
  directory: DirectoryUser[];
  canBroadcast: boolean;
  canTeam: boolean;
}

const KIND_ICON = {
  broadcast: Megaphone,
  team: Users,
  direct: UserIcon,
} as const;

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  ) {
    return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

export function ChatShell({ threads, directory, canBroadcast, canTeam }: Props) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(threads[0]?.id ?? null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [newOpen, setNewOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const active = threads.find((t) => t.id === activeId) ?? null;

  // Cargar mensajes cuando cambia el hilo activo
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    setLoadingMsgs(true);
    getChatMessages(activeId)
      .then((rows) => {
        setMessages(rows);
        // marcar leído en background
        markChatThreadRead(activeId).then(() => router.refresh()).catch(() => {});
      })
      .finally(() => setLoadingMsgs(false));
  }, [activeId, router]);

  // Auto-scroll al fondo
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  function send() {
    if (!activeId || !draft.trim()) return;
    const body = draft;
    setDraft("");
    startTransition(async () => {
      try {
        await sendChatMessageAction(activeId, body);
        const rows = await getChatMessages(activeId);
        setMessages(rows);
        router.refresh();
      } catch (err) {
        notify.error("No se pudo enviar", err instanceof Error ? err.message : String(err));
        setDraft(body);
      }
    });
  }

  const canSend =
    !!active &&
    (active.kind !== "broadcast" || canBroadcast);

  return (
    <>
      <div className="grid h-[calc(100vh-12rem)] grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[300px_1fr]">
        {/* Lista de hilos */}
        <aside
          className={cn(
            "flex flex-col overflow-hidden rounded-2xl border border-border bg-card",
            active && "hidden lg:flex",
          )}
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Conversaciones
            </h2>
            <Button size="sm" variant="ghost" onClick={() => setNewOpen(true)} className="gap-1">
              <Plus className="h-4 w-4" /> Nuevo
            </Button>
          </div>
          <ul className="flex-1 overflow-y-auto">
            {threads.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                No tienes conversaciones todavía.
              </li>
            )}
            {threads.map((t) => {
              const Icon = KIND_ICON[t.kind];
              const isActive = activeId === t.id;
              return (
                <li key={t.id}>
                  <button
                    onClick={() => setActiveId(t.id)}
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-border/60 px-3 py-3 text-left transition-colors",
                      isActive
                        ? "bg-primary/10"
                        : "hover:bg-muted/40",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                        t.kind === "broadcast" && "bg-amber-100 text-amber-700",
                        t.kind === "team" && "bg-blue-100 text-blue-700",
                        t.kind === "direct" && "bg-emerald-100 text-emerald-700",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">
                          {t.display_name}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {formatTime(t.last_message_at)}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground capitalize">
                        {t.kind === "broadcast"
                          ? "Aviso general"
                          : t.kind === "team"
                            ? "Equipo"
                            : "Privado"}
                      </div>
                    </div>
                    {t.unread > 0 && (
                      <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                        {t.unread}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Panel de conversación */}
        <section
          className={cn(
            "flex flex-col overflow-hidden rounded-2xl border border-border bg-card",
            !active && "hidden lg:flex",
          )}
        >
          {!active ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Selecciona una conversación.
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b px-4 py-3">
                <button
                  onClick={() => setActiveId(null)}
                  className="lg:hidden flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
                  aria-label="Volver"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-base font-bold">{active.display_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {active.kind === "broadcast"
                      ? "Aviso general · visible para toda la empresa"
                      : active.kind === "team"
                        ? "Hilo de equipo"
                        : "Conversación privada"}
                  </div>
                </div>
              </header>

              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                {loadingMsgs && (
                  <div className="text-center text-xs text-muted-foreground">Cargando…</div>
                )}
                {!loadingMsgs && messages.length === 0 && (
                  <div className="text-center text-xs text-muted-foreground">
                    No hay mensajes todavía. ¡Rompe el hielo!
                  </div>
                )}
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "flex flex-col",
                      m.is_mine ? "items-end" : "items-start",
                    )}
                  >
                    {!m.is_mine && (
                      <span className="ml-2 text-[10px] font-semibold text-muted-foreground">
                        {m.sender_name}
                      </span>
                    )}
                    <div
                      className={cn(
                        "max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words",
                        m.is_mine
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted",
                      )}
                    >
                      {m.body}
                    </div>
                    <span className="mt-0.5 text-[10px] text-muted-foreground">
                      {new Date(m.created_at).toLocaleTimeString("es-ES", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <footer className="border-t px-3 py-3">
                {!canSend ? (
                  <div className="text-center text-xs text-muted-foreground">
                    Sólo el admin puede escribir en este aviso.
                  </div>
                ) : (
                  <div className="flex items-end gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      placeholder="Escribe un mensaje…"
                      rows={1}
                      className="flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    />
                    <Button
                      onClick={send}
                      disabled={pending || !draft.trim()}
                      className="gap-1"
                    >
                      <Send className="h-4 w-4" />
                      <span className="hidden sm:inline">Enviar</span>
                    </Button>
                  </div>
                )}
              </footer>
            </>
          )}
        </section>
      </div>

      <NewThreadDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        directory={directory}
        canBroadcast={canBroadcast}
        canTeam={canTeam}
        onCreated={(id) => {
          setNewOpen(false);
          setActiveId(id);
          router.refresh();
        }}
      />
    </>
  );
}

function NewThreadDialog({
  open,
  onOpenChange,
  directory,
  canBroadcast,
  canTeam,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  directory: DirectoryUser[];
  canBroadcast: boolean;
  canTeam: boolean;
  onCreated: (id: string) => void;
}) {
  const [tab, setTab] = useState<"direct" | "team" | "broadcast">("direct");
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  function reset() {
    setTab("direct");
    setName("");
    setSelectedIds([]);
  }

  function toggle(uid: string) {
    setSelectedIds((s) =>
      s.includes(uid) ? s.filter((x) => x !== uid) : [...s, uid],
    );
  }

  function create() {
    startTransition(async () => {
      try {
        let id: string;
        if (tab === "direct") {
          const uid = selectedIds[0];
          if (!uid) {
            notify.warning("Elige un usuario");
            return;
          }
          id = await getOrCreateDirectThreadAction(uid);
        } else if (tab === "team") {
          if (selectedIds.length === 0) {
            notify.warning("Añade al menos un miembro");
            return;
          }
          id = await createTeamThreadAction(name, selectedIds);
        } else {
          id = await createBroadcastThreadAction(name);
        }
        notify.success("Conversación creada");
        reset();
        onCreated(id);
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva conversación</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 border-b pb-3">
          <button
            onClick={() => setTab("direct")}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-semibold",
              tab === "direct"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
          >
            <UserIcon className="mr-1 inline h-3.5 w-3.5" /> Privado
          </button>
          {canTeam && (
            <button
              onClick={() => setTab("team")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-semibold",
                tab === "team"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              <Users className="mr-1 inline h-3.5 w-3.5" /> Equipo
            </button>
          )}
          {canBroadcast && (
            <button
              onClick={() => setTab("broadcast")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-semibold",
                tab === "broadcast"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              <Megaphone className="mr-1 inline h-3.5 w-3.5" /> Aviso general
            </button>
          )}
        </div>

        <div className="space-y-3">
          {tab !== "direct" && (
            <div className="space-y-1.5">
              <Label>Nombre del hilo</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  tab === "broadcast" ? "Avisos generales" : "Equipo de instalación"
                }
              />
            </div>
          )}

          {tab !== "broadcast" && (
            <div className="space-y-1.5">
              <Label>
                {tab === "direct" ? "Usuario" : "Miembros del equipo"}
              </Label>
              <div className="max-h-64 overflow-y-auto rounded-xl border">
                {directory.length === 0 && (
                  <div className="p-4 text-center text-xs text-muted-foreground">
                    No hay otros usuarios en la empresa.
                  </div>
                )}
                {directory.map((u) => {
                  const checked = selectedIds.includes(u.user_id);
                  return (
                    <button
                      key={u.user_id}
                      type="button"
                      onClick={() => {
                        if (tab === "direct") setSelectedIds([u.user_id]);
                        else toggle(u.user_id);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm",
                        checked
                          ? "bg-primary/10"
                          : "hover:bg-muted/40",
                      )}
                    >
                      <input
                        type={tab === "direct" ? "radio" : "checkbox"}
                        checked={checked}
                        readOnly
                        className="pointer-events-none"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-semibold">{u.full_name}</div>
                        {u.role_label && (
                          <div className="text-xs text-muted-foreground">
                            {u.role_label}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "broadcast" && (
            <p className="text-xs text-muted-foreground">
              Los avisos generales son visibles para todos los usuarios de la empresa.
              Solo el admin puede escribir en ellos.
            </p>
          )}

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={create} disabled={pending} variant="success">
              {pending ? "Creando…" : "Crear"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
