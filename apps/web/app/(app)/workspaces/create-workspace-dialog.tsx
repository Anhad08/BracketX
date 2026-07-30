"use client";

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Field,
  FormError,
  Input,
} from "@bracketx/ui";
import { Plus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { createWorkspaceAction } from "../../actions/workspaces";
import { idle } from "../../actions/state";
import { slugify } from "../../lib/slugify";

export function CreateWorkspaceDialog({
  defaultOpen = false,
}: {
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [state, formAction, pending] = useActionState(
    createWorkspaceAction,
    idle,
  );

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  // Derive the slug from the name until the user takes it over — after that,
  // silently rewriting what they typed would be hostile.
  useEffect(() => {
    if (!slugEdited) setSlug(slugify(name));
  }, [name, slugEdited]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm" leadingIcon={<Plus />}>
          New workspace
        </Button>
      </DialogTrigger>

      <DialogContent
        title="Create a workspace"
        description="Workspace names are yours; the URL is claimed globally, first come first served."
      >
        <form id="create-workspace" action={formAction} className="flex flex-col gap-4">
          {state.error ? <FormError>{state.error}</FormError> : null}

          <Field label="Name" error={state.fieldErrors?.name}>
            {(props) => (
              <Input
                {...props}
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme Esports"
                autoFocus
                required
              />
            )}
          </Field>

          <Field
            label="URL"
            error={state.fieldErrors?.slug}
            hint={slug ? `bracketx.app/w/${slug}` : "Lowercase letters, numbers, and hyphens."}
          >
            {(props) => (
              <Input
                {...props}
                name="slug"
                value={slug}
                onChange={(event) => {
                  setSlugEdited(true);
                  setSlug(event.target.value);
                }}
                placeholder="acme-esports"
                className="font-mono"
                required
              />
            )}
          </Field>
        </form>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost" size="sm" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button
            form="create-workspace"
            type="submit"
            variant="primary"
            size="sm"
            loading={pending}
          >
            Create workspace
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
