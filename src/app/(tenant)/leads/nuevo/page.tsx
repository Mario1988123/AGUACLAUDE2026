import { LeadCreateForm } from "@/modules/leads/create-form";

export default function NuevoLeadPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nuevo lead</h1>
        <p className="text-sm text-muted-foreground">
          Particular o empresa. Si eres nivel 3, el lead queda asignado a ti automáticamente.
        </p>
      </div>
      <LeadCreateForm />
    </div>
  );
}
