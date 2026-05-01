import { Construction } from "lucide-react";

export function ModulePlaceholder({ title, description }: { title: string; description?: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-card p-12 text-center">
        <Construction className="h-10 w-10 text-muted-foreground" />
        <p className="text-base font-medium">Módulo en construcción</p>
        {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}
