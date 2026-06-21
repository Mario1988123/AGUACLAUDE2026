"use client";

import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserSupabase } from "@/shared/lib/supabase/client";
import {
  Megaphone,
  Users,
  User as UserIcon,
  Send,
  Plus,
  ArrowLeft,
  Mic,
  Paperclip,
  MapPin,
  UserPlus,
  FileText,
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
import { useConfirm } from "@/shared/components/confirm-dialog";
import { cn } from "@/shared/lib/utils";
import {
  getChatMessages,
  markChatThreadRead,
  sendChatMessageSafeAction,
  sendChatVoiceMessageSafeAction,
  sendChatAttachmentSafeAction,
  sendChatContactSafeAction,
  sendChatLocationSafeAction,
  createBroadcastThreadSafeAction,
  createTeamThreadSafeAction,
  getOrCreateDirectThreadSafeAction,
  editChatMessageSafeAction,
  deleteChatMessageSafeAction,
  type ChatMessageRow,
  type ChatThreadRow,
  type DirectoryUser,
} from "./actions";
import { Pencil, Trash2 } from "lucide-react";
import { SubjectPickerModal } from "@/modules/agenda/subject-picker-modal";
import type { AgendaSubjectHit } from "@/modules/agenda/actions";

interface Props {
  threads: ChatThreadRow[];
  directory: DirectoryUser[];
  canBroadcast: boolean;
  canTeam: boolean;
  currentUserId: string;
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

/** Pitido corto al recibir un mensaje (Web Audio, sin archivo de sonido). */
function playChatBeep() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
    osc.onended = () => ctx.close();
  } catch {
    /* silencio */
  }
}

export function ChatShell({
  threads,
  directory,
  canBroadcast,
  canTeam,
  currentUserId,
}: Props) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(threads[0]?.id ?? null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [newOpen, setNewOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Refs con los últimos threads/directory para el handler de tiempo real
  // (evita re-suscribir el canal en cada mensaje).
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const directoryRef = useRef(directory);
  directoryRef.current = directory;

  // Estado de grabación de nota de voz
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recStartRef = useRef(0);
  const recCancelRef = useRef(false);

  // Adjuntos / contacto / ubicación
  const [attachOpen, setAttachOpen] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Pedir permiso de notificaciones del navegador una vez.
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

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

  // Realtime: suscribir al canal de mensajes globales y refrescar cuando llega
  // uno del hilo activo o cualquiera (para actualizar badges del sidebar).
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel("chat-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as {
            thread_id: string;
            sender_id: string;
            body: string | null;
            audio_path?: string | null;
            attachment_path?: string | null;
            meta?: { type?: string } | null;
          };
          if (row.thread_id === activeId) {
            getChatMessages(activeId).then(setMessages).catch(() => {});
          } else if (
            row.sender_id !== currentUserId &&
            threadsRef.current.some((t) => t.id === row.thread_id)
          ) {
            // Mensaje entrante en otro hilo mío → aviso pop-up + sonido.
            const senderName =
              directoryRef.current.find((u) => u.user_id === row.sender_id)
                ?.full_name ?? "Nuevo mensaje";
            const preview = row.audio_path
              ? "🎤 Nota de voz"
              : row.attachment_path
                ? "📎 Archivo adjunto"
                : row.meta?.type === "contact"
                  ? "👤 Contacto"
                  : row.meta?.type === "location"
                    ? "📍 Ubicación"
                    : (row.body ?? "").slice(0, 80) || "Nuevo mensaje";
            notify.info(senderName, preview);
            playChatBeep();
            try {
              if (
                document.hidden &&
                "Notification" in window &&
                Notification.permission === "granted"
              ) {
                new Notification(senderName, { body: preview });
              }
            } catch {
              /* notificaciones no disponibles */
            }
          }
          // Refrescar layout (sidebar badges, lista de hilos)
          router.refresh();
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [activeId, router, currentUserId]);

  function send() {
    if (!activeId || !draft.trim()) return;
    const body = draft;
    setDraft("");
    startTransition(async () => {
      const r = await sendChatMessageSafeAction(activeId, body);
      if (!r.ok) {
        notify.error("No se pudo enviar", r.error);
        setDraft(body);
        return;
      }
      const rows = await getChatMessages(activeId);
      setMessages(rows);
      router.refresh();
    });
  }

  async function sendVoice(blob: Blob, durationMs: number) {
    if (!activeId) return;
    const dataUrl: string = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    startTransition(async () => {
      const r = await sendChatVoiceMessageSafeAction(activeId, dataUrl, durationMs);
      if (!r.ok) {
        notify.error("No se pudo enviar la nota de voz", r.error);
        return;
      }
      const rows = await getChatMessages(activeId);
      setMessages(rows);
      router.refresh();
    });
  }

  async function onFilePicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeId) return;
    if (file.size > 8 * 1024 * 1024) {
      notify.error("Archivo muy grande", "El máximo es 8 MB.");
      return;
    }
    const threadId = activeId;
    const dataUrl: string = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
    startTransition(async () => {
      const r = await sendChatAttachmentSafeAction(
        threadId,
        dataUrl,
        file.name,
        file.type,
      );
      if (!r.ok) {
        notify.error("No se pudo adjuntar", r.error);
        return;
      }
      const rows = await getChatMessages(threadId);
      setMessages(rows);
      router.refresh();
    });
  }

  function shareContact(hit: AgendaSubjectHit) {
    if (!activeId) return;
    const threadId = activeId;
    startTransition(async () => {
      const r = await sendChatContactSafeAction(
        threadId,
        hit.subject_type as "customer" | "lead",
        hit.subject_id,
      );
      if (!r.ok) {
        notify.error("No se pudo compartir", r.error);
        return;
      }
      const rows = await getChatMessages(threadId);
      setMessages(rows);
      router.refresh();
    });
  }

  function shareLocation() {
    if (!activeId) return;
    if (!navigator.geolocation) {
      notify.error("Ubicación", "Tu navegador no permite compartir ubicación.");
      return;
    }
    const threadId = activeId;
    notify.info("Ubicación", "Obteniendo tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        startTransition(async () => {
          const r = await sendChatLocationSafeAction(
            threadId,
            latitude,
            longitude,
          );
          if (!r.ok) {
            notify.error("No se pudo compartir", r.error);
            return;
          }
          const rows = await getChatMessages(threadId);
          setMessages(rows);
          router.refresh();
        });
      },
      () =>
        notify.error(
          "Ubicación",
          "No se pudo obtener tu ubicación. Revisa los permisos.",
        ),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function stopRecording() {
    recCancelRef.current = false;
    mediaRecorderRef.current?.stop();
  }
  function cancelRecording() {
    recCancelRef.current = true;
    mediaRecorderRef.current?.stop();
  }
  async function startRecording() {
    if (!activeId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recCancelRef.current = false;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recTimerRef.current) {
          clearInterval(recTimerRef.current);
          recTimerRef.current = null;
        }
        const durationMs = Date.now() - recStartRef.current;
        const wasCancelled = recCancelRef.current;
        setRecording(false);
        setRecSeconds(0);
        if (wasCancelled || audioChunksRef.current.length === 0) return;
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        void sendVoice(blob, durationMs);
      };
      mediaRecorderRef.current = mr;
      recStartRef.current = Date.now();
      mr.start();
      setRecording(true);
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - recStartRef.current) / 1000);
        setRecSeconds(s);
        if (s >= 120) stopRecording(); // tope 2 min (límite de tamaño)
      }, 250);
    } catch {
      notify.error(
        "Micrófono",
        "No se pudo acceder al micrófono. Revisa los permisos del navegador.",
      );
    }
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
                            ? "Grupo"
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
                        ? "Grupo"
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
                  <ChatMessageItem
                    key={m.id}
                    message={m}
                    onChanged={() => {
                      if (!activeId) return;
                      getChatMessages(activeId)
                        .then(setMessages)
                        .catch(() => {});
                    }}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>

              <footer className="border-t px-3 py-3">
                {!canSend ? (
                  <div className="text-center text-xs text-muted-foreground">
                    Sólo el admin puede escribir en este aviso.
                  </div>
                ) : recording ? (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-2 text-sm font-semibold text-destructive">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive" />
                      Grabando… {Math.floor(recSeconds / 60)}:
                      {String(recSeconds % 60).padStart(2, "0")}
                    </span>
                    <div className="ml-auto flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={cancelRecording}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={stopRecording}
                        disabled={pending}
                        className="gap-1"
                      >
                        <Send className="h-4 w-4" /> Enviar voz
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-end gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={onFilePicked}
                    />
                    <div className="relative shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setAttachOpen((o) => !o)}
                        title="Adjuntar"
                        aria-label="Adjuntar"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                      {attachOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setAttachOpen(false)}
                          />
                          <div className="absolute bottom-12 left-0 z-20 w-48 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
                            <button
                              type="button"
                              onClick={() => {
                                setAttachOpen(false);
                                fileInputRef.current?.click();
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted"
                            >
                              <Paperclip className="h-4 w-4" /> Foto o archivo
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAttachOpen(false);
                                setContactPickerOpen(true);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted"
                            >
                              <UserPlus className="h-4 w-4" /> Compartir contacto
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAttachOpen(false);
                                shareLocation();
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted"
                            >
                              <MapPin className="h-4 w-4" /> Mi ubicación
                            </button>
                          </div>
                        </>
                      )}
                    </div>
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
                      type="button"
                      variant="outline"
                      onClick={startRecording}
                      disabled={pending}
                      title="Grabar nota de voz"
                      aria-label="Grabar nota de voz"
                      className="shrink-0"
                    >
                      <Mic className="h-4 w-4" />
                    </Button>
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
      <SubjectPickerModal
        open={contactPickerOpen}
        onClose={() => setContactPickerOpen(false)}
        onSelect={shareContact}
        title="Compartir contacto en el chat"
      />
    </>
  );
}

function ChatMessageItem({
  message,
  onChanged,
}: {
  message: ChatMessageRow;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [pending, startTransition] = useTransition();
  const ask = useConfirm();

  function save() {
    if (!draft.trim() || draft.trim() === message.body) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const r = await editChatMessageSafeAction(message.id, draft);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      setEditing(false);
      onChanged();
    });
  }

  async function remove() {
    const ok = await ask({
      message: "¿Eliminar este mensaje?",
      confirmText: "Eliminar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await deleteChatMessageSafeAction(message.id);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      onChanged();
    });
  }

  const meta = (message.meta ?? null) as {
    type?: string;
    subject_type?: string;
    subject_id?: string;
    name?: string;
    lat?: number | string;
    lng?: number | string;
  } | null;

  return (
    <div
      className={cn(
        "group flex w-full flex-col",
        message.is_mine ? "items-end" : "items-start",
      )}
    >
      {!message.is_mine && (
        <span className="ml-2 text-[10px] font-semibold text-muted-foreground">
          {message.sender_name}
        </span>
      )}
      {editing ? (
        <div className="w-full max-w-[80%] space-y-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              Guardar
            </Button>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "flex w-full items-center gap-1.5",
            message.is_mine ? "justify-end" : "justify-start",
          )}
        >
          {message.is_mine && (
            <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              {!message.audio_url && !message.attachment_url && !meta && (
                <button
                  onClick={() => setEditing(true)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                  title="Editar"
                  aria-label="Editar"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
              <button
                onClick={remove}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
                title="Eliminar"
                aria-label="Eliminar"
                disabled={pending}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </button>
            </div>
          )}
          <div
            className={cn(
              "w-fit max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words",
              message.is_mine ? "bg-primary text-primary-foreground" : "bg-muted",
            )}
          >
            {message.audio_url ? (
              <audio
                controls
                src={message.audio_url}
                className="h-9 w-[230px] max-w-full"
              />
            ) : message.attachment_url &&
              message.attachment_mime?.startsWith("image/") ? (
              <a
                href={message.attachment_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={message.attachment_url}
                  alt={message.attachment_name ?? "imagen"}
                  className="max-h-60 max-w-full rounded-lg"
                />
              </a>
            ) : message.attachment_url ? (
              <a
                href={message.attachment_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 underline"
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  {message.attachment_name ?? "Archivo"}
                </span>
              </a>
            ) : meta?.type === "contact" ? (
              <a
                href={`/${meta.subject_type === "lead" ? "leads" : "clientes"}/${meta.subject_id}`}
                className="flex items-center gap-2 underline"
              >
                <UserIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">{meta.name ?? "Contacto"}</span>
              </a>
            ) : meta?.type === "location" ? (
              <a
                href={`https://www.google.com/maps?q=${meta.lat},${meta.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 underline"
              >
                <MapPin className="h-4 w-4 shrink-0" /> Ver ubicación
              </a>
            ) : (
              <>
                {message.body}
                {message.edited_at && (
                  <span className="ml-1 text-[10px] opacity-70">(editado)</span>
                )}
              </>
            )}
          </div>
        </div>
      )}
      <span className="mt-0.5 text-[10px] text-muted-foreground">
        {new Date(message.created_at).toLocaleTimeString("es-ES", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    </div>
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
      let res: { ok: true; id: string } | { ok: false; error: string };
      if (tab === "direct") {
        const uid = selectedIds[0];
        if (!uid) {
          notify.warning("Elige un usuario");
          return;
        }
        res = await getOrCreateDirectThreadSafeAction(uid);
      } else if (tab === "team") {
        if (selectedIds.length === 0) {
          notify.warning("Añade al menos un miembro");
          return;
        }
        res = await createTeamThreadSafeAction(name, selectedIds);
      } else {
        res = await createBroadcastThreadSafeAction(name);
      }
      if (!res.ok) {
        notify.error("Error", res.error);
        return;
      }
      notify.success("Conversación creada");
      reset();
      onCreated(res.id);
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
            // "Grupo" = hilo con varias personas (kind team en BD).
            <button
              onClick={() => setTab("team")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-semibold",
                tab === "team"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              <Users className="mr-1 inline h-3.5 w-3.5" /> Grupo
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
                  tab === "broadcast" ? "Avisos generales" : "Grupo de ventas"
                }
              />
            </div>
          )}

          {tab !== "broadcast" && (
            <div className="space-y-1.5">
              <Label>
                {tab === "direct" ? "Usuario" : "Miembros del grupo"}
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
