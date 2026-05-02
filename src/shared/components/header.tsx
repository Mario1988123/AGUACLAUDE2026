"use client";

import { Bell } from "lucide-react";
import Link from "next/link";

interface HeaderProps {
  title?: string;
  unreadCount?: number;
}

export function Header({ title, unreadCount = 0 }: HeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-6 lg:px-8">
      <h1 className="ml-16 text-lg font-semibold tracking-tight lg:ml-0">{title ?? ""}</h1>
      <div className="flex items-center gap-3">
        <Link
          href="/notificaciones"
          className="relative inline-flex h-12 w-12 items-center justify-center rounded-full hover:bg-muted"
          aria-label="Notificaciones"
          prefetch={false}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-medium text-destructive-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
