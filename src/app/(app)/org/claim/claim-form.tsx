"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/validation";
import { claimOrg } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-brand-teal text-primary-foreground hover:bg-brand-teal/90"
    >
      {pending ? "Claiming…" : "Claim organization"}
    </Button>
  );
}

export function ClaimOrgForm() {
  const [state, formAction] = useActionState(claimOrg, undefined);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="name" className="label-mono text-muted-foreground/70">
          Organization name
        </Label>
        <Input
          id="name"
          name="name"
          required
          placeholder="Promotizar Digital"
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground/50"
          onChange={(e) => {
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="slug" className="label-mono text-muted-foreground/70">
          Slug
        </Label>
        <Input
          id="slug"
          name="slug"
          required
          value={slug}
          placeholder="promotizar-digital"
          className="border-border bg-muted font-mono text-sm text-foreground placeholder:text-muted-foreground/50"
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
        />
      </div>
      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
