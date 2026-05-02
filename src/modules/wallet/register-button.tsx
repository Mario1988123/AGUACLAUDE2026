"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { RegisterPaymentForm } from "./register-form";

interface Props {
  contractId?: string;
  customerId?: string;
  installationId?: string;
  defaultConcept?: string;
  defaultAmountCents?: number;
  triggerLabel?: string;
}

export function RegisterPaymentButton({
  contractId,
  customerId,
  installationId,
  defaultConcept,
  defaultAmountCents,
  triggerLabel = "+ Registrar cobro",
}: Props) {
  const [open, setOpen] = useState(false);

  if (open) {
    return (
      <Card>
        <CardContent className="pt-6">
          <RegisterPaymentForm
            contractId={contractId}
            customerId={customerId}
            installationId={installationId}
            defaultConcept={defaultConcept}
            defaultAmountCents={defaultAmountCents}
            onDone={() => setOpen(false)}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Button onClick={() => setOpen(true)} variant="success">
      <Plus className="h-4 w-4" /> {triggerLabel}
    </Button>
  );
}
