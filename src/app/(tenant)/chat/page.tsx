import { requireSession } from "@/shared/lib/auth/session";
import { listChatThreads, listCompanyDirectory } from "@/modules/chat/actions";
import { ChatShell } from "@/modules/chat/chat-shell";

export const dynamic = "force-dynamic";

const LEADER_ROLES = new Set([
  "company_admin",
  "technical_director",
  "commercial_director",
  "telemarketing_director",
]);

export default async function ChatPage() {
  const session = await requireSession();
  const [threads, directory] = await Promise.all([
    listChatThreads(),
    listCompanyDirectory(),
  ]);

  const canBroadcast = session.is_superadmin || session.roles.includes("company_admin");
  const canTeam =
    session.is_superadmin || session.roles.some((r) => LEADER_ROLES.has(r));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Chat</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Avisos generales, hilos de equipo y conversaciones privadas.
        </p>
      </div>
      <ChatShell
        threads={threads}
        directory={directory}
        canBroadcast={canBroadcast}
        canTeam={canTeam}
      />
    </div>
  );
}
