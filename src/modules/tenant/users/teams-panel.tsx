"use client";

import { useState, useTransition } from "react";
import { Users, UserPlus, X, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { notify } from "@/shared/hooks/use-toast";
import {
  assignToTeamAction,
  removeFromTeamAction,
} from "./team-actions";

interface Team {
  director_user_id: string;
  director_full_name: string;
  director_roles: string[];
  members: Array<{
    user_id: string;
    full_name: string;
    roles: string[];
    manager_user_id: string | null;
  }>;
}

interface UnassignedMember {
  user_id: string;
  full_name: string;
  roles: string[];
}

const ROLE_LABEL: Record<string, string> = {
  technical_director: "Director técnico",
  commercial_director: "Director comercial",
  telemarketing_director: "Director TMK",
  sales_rep: "Comercial",
  telemarketer: "Teleoperador",
  installer: "Instalador",
};

export function TeamsPanel({
  teams,
  unassigned,
}: {
  teams: Team[];
  unassigned: UnassignedMember[];
}) {
  const [expandedDirectorId, setExpandedDirectorId] = useState<string | null>(
    teams[0]?.director_user_id ?? null,
  );
  const [pickerOpenForDirector, setPickerOpenForDirector] = useState<
    string | null
  >(null);
  const [pending, startTransition] = useTransition();
  const ask = useConfirm();

  function assign(directorId: string, memberId: string) {
    startTransition(async () => {
      try {
        await assignToTeamAction(directorId, memberId);
        notify.success("Asignado al equipo");
        setPickerOpenForDirector(null);
        location.reload();
      } catch (err) {
        notify.error(
          "Error",
          err instanceof Error ? err.message : String(err),
        );
      }
    });
  }

  async function remove(memberId: string, memberName: string) {
    const ok = await ask({
      message: `¿Quitar a ${memberName} del equipo? Volverá a la lista de operativos sin asignar.`,
      confirmText: "Quitar",
      variant: "warning",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await removeFromTeamAction(memberId);
        notify.success("Eliminado del equipo");
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (teams.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Aún no hay directores en la empresa. Crea usuarios con rol{" "}
          <strong>Director técnico</strong>, <strong>Director comercial</strong>{" "}
          o <strong>Director TMK</strong> para poder formar equipos.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {teams.map((team) => {
        const expanded = expandedDirectorId === team.director_user_id;
        const isPickerOpen = pickerOpenForDirector === team.director_user_id;
        return (
          <Card key={team.director_user_id}>
            <CardHeader
              onClick={() =>
                setExpandedDirectorId(expanded ? null : team.director_user_id)
              }
              className="flex cursor-pointer flex-row items-center justify-between gap-3 hover:bg-muted/30"
            >
              <div className="flex items-center gap-3">
                {expanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <Users className="h-4 w-4 text-primary" />
                <div>
                  <CardTitle className="text-base">
                    {team.director_full_name}
                  </CardTitle>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {team.director_roles
                      .filter((r) => r.endsWith("_director"))
                      .map((r) => (
                        <Badge key={r} variant="secondary" className="text-[10px]">
                          {ROLE_LABEL[r] ?? r}
                        </Badge>
                      ))}
                  </div>
                </div>
              </div>
              <Badge variant="outline" className="shrink-0">
                {team.members.length}{" "}
                {team.members.length === 1 ? "miembro" : "miembros"}
              </Badge>
            </CardHeader>
            {expanded && (
              <CardContent className="space-y-2 border-t pt-3">
                {team.members.length === 0 ? (
                  <p className="text-xs italic text-muted-foreground">
                    Sin miembros asignados.
                  </p>
                ) : (
                  team.members.map((m) => (
                    <div
                      key={m.user_id}
                      className="flex items-center justify-between gap-2 rounded-lg border bg-card p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{m.full_name}</div>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {m.roles
                            .filter((r) =>
                              ["sales_rep", "telemarketer", "installer"].includes(r),
                            )
                            .map((r) => (
                              <Badge
                                key={r}
                                variant="outline"
                                className="text-[10px]"
                              >
                                {ROLE_LABEL[r] ?? r}
                              </Badge>
                            ))}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => remove(m.user_id, m.full_name)}
                        disabled={pending}
                        aria-label="Quitar del equipo"
                        title="Quitar del equipo"
                      >
                        <X className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))
                )}

                {/* Botón / picker para añadir */}
                {!isPickerOpen ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setPickerOpenForDirector(team.director_user_id)
                    }
                    disabled={unassigned.length === 0}
                    className="w-full"
                  >
                    <UserPlus className="h-4 w-4" />
                    {unassigned.length === 0
                      ? "No hay operativos sin asignar"
                      : "Añadir miembro al equipo"}
                  </Button>
                ) : (
                  <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-2">
                    <p className="mb-2 text-xs font-bold">Selecciona un operativo</p>
                    <div className="space-y-1">
                      {unassigned.map((u) => (
                        <button
                          key={u.user_id}
                          type="button"
                          onClick={() => assign(team.director_user_id, u.user_id)}
                          disabled={pending}
                          className="flex w-full items-center justify-between gap-2 rounded-md border bg-card p-2 text-left text-sm hover:border-primary"
                        >
                          <div>
                            <div className="font-semibold">{u.full_name}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {u.roles.map((r) => ROLE_LABEL[r] ?? r).join(", ")}
                            </div>
                          </div>
                          <UserPlus className="h-3.5 w-3.5 text-primary" />
                        </button>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPickerOpenForDirector(null)}
                      className="mt-2 w-full"
                    >
                      Cancelar
                    </Button>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}

      {unassigned.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Operativos sin asignar ({unassigned.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="mb-2 text-xs text-muted-foreground">
              Estos usuarios tienen rol operativo pero no están en ningún
              equipo. Asígnaselos a un director arriba.
            </p>
            {unassigned.map((u) => (
              <div
                key={u.user_id}
                className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2"
              >
                <div className="text-sm font-semibold">{u.full_name}</div>
                <div className="flex flex-wrap gap-1">
                  {u.roles.map((r) => (
                    <Badge key={r} variant="outline" className="text-[10px]">
                      {ROLE_LABEL[r] ?? r}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
