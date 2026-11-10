import { requireSession } from "@/shared/lib/auth/session";
import { listChatThreads, listCompanyDirectory } from "@/modules/chat/actions";
import { ChatShell } from "@/modules/chat/chat-shell";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const session = await requireSession();
  const [threads, directory] = await Promise.all([
    listChatThreads(),
    listCompanyDirectory(),
  ]);

  const canBroadcast = session.is_superadmin || session.roles.includes("company_admin");
  // Grupos: cualquier usuario puede crear un grupo con varias personas.
  const canTeam = true;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Chat</h1>
        {/* En movil se oculta: la altura es para la conversacion. */}
        <p className="mt-1 hidden text-sm text-muted-foreground md:block">
          Avisos generales, hilos de equipo y conversaciones privadas.
        </p>
      </div>
      <ChatShell
        threads={threads}
        directory={directory}
        canBroadcast={canBroadcast}
        canTeam={canTeam}
        currentUserId={session.user_id}
      />
    </div>
  );
}
