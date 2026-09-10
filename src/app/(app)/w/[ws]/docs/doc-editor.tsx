"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createWorkspaceDocAction,
  updateWorkspaceDocAction,
  type DocState,
} from "./actions";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

/**
 * "use client" title + body editor. Two modes via the `mode` prop:
 * - "create": posts to createWorkspaceDocAction, then navigates to the new
 *   doc's detail page once a slug comes back.
 * - "edit": posts to updateWorkspaceDocAction for an existing doc, used by
 *   the detail page's view/edit toggle.
 */
export function DocEditor(
  props:
    | {
        mode: "create";
        workspaceId: string;
        onCancel?: () => void;
      }
    | {
        mode: "edit";
        workspaceId: string;
        docId: string;
        initialTitle: string;
        initialBody: string;
        initialKind: "doc" | "sop" | "auto";
        onSaved?: () => void;
      },
) {
  const router = useRouter();
  const action =
    props.mode === "create" ? createWorkspaceDocAction : updateWorkspaceDocAction;

  const [state, formAction] = useFormState<DocState, FormData>(
    async (prev, formData) => {
      const result = await action(prev, formData);
      if (!result?.error) {
        if (props.mode === "create" && result?.slug) {
          router.push(`/w/${props.workspaceId}/docs/${result.slug}`);
        } else if (props.mode === "edit") {
          props.onSaved?.();
        }
      }
      return result;
    },
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="workspaceId" value={props.workspaceId} />
      {props.mode === "edit" ? (
        <input type="hidden" name="docId" value={props.docId} />
      ) : null}

      <Input
        name="title"
        placeholder="Doc title"
        maxLength={140}
        required
        defaultValue={props.mode === "edit" ? props.initialTitle : undefined}
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground/70">
        <span>Kind</span>
        <select
          name="kind"
          defaultValue={props.mode === "edit" ? props.initialKind : "doc"}
          className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand-teal/50"
        >
          <option value="doc">Doc</option>
          <option value="sop">SOP (standard operating procedure)</option>
        </select>
      </label>
      <Textarea
        name="body"
        placeholder="Write in Markdown…"
        rows={14}
        className="font-mono text-xs"
        defaultValue={props.mode === "edit" ? props.initialBody : undefined}
      />

      <div className="flex items-center gap-3">
        <SubmitButton
          label={props.mode === "create" ? "Create doc" : "Save"}
          pendingLabel={props.mode === "create" ? "Creating…" : "Saving…"}
        />
        {props.mode === "create" && props.onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={props.onCancel}>
            Cancel
          </Button>
        ) : null}
        {state?.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      </div>
    </form>
  );
}
