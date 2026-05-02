"use client";

import { Search } from "lucide-react";
import { NotificationsBell } from "./notifications-poller";

interface HeaderProps {
  unreadCount?: number;
}

/**
 * Header estilo DashStack — search bar central + notifications + avatar.
 */
export function Header({ unreadCount = 0 }: HeaderProps) {
  return (
    <header className="flex h-20 items-center justify-between gap-4 border-b bg-card px-6 lg:px-8">
      <div className="ml-16 flex flex-1 items-center gap-4 lg:ml-0">
        <div className="relative hidden flex-1 max-w-md md:block">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Buscar..."
            className="h-12 w-full rounded-2xl border border-border bg-muted/50 pl-11 pr-4 text-sm placeholder:text-muted-foreground focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <NotificationsBell initialCount={unreadCount} />
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
          M
        </div>
      </div>
    </header>
  );
}
