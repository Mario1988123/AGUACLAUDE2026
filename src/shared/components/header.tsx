"use client";

import { NotificationsBell } from "./notifications-poller";
import { GlobalSearchTrigger } from "@/modules/search/global-search";

interface HeaderProps {
  unreadCount?: number;
}

/**
 * Header estilo DashStack — search global cmd+k + notifications + avatar.
 */
export function Header({ unreadCount = 0 }: HeaderProps) {
  return (
    <header className="flex h-20 items-center justify-between gap-4 border-b bg-card px-6 lg:px-8">
      <div className="ml-16 flex flex-1 items-center gap-4 lg:ml-0">
        <GlobalSearchTrigger />
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
