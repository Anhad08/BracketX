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

import { createProjectAction } from "../../../actions/projects";
import { idle } from "../../../actions/state";
import { slugify } from "../../../lib/slugify";

export function CreateProjectDialog({
  workspaceSlug,
}: {
  workspaceSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createProjectAction, idle);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  useEffect(() => {
    if (!slugEdited) setSlug(slugify(name));
  }, [name, slugEdited]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm" leadingIcon={<Plus />}>
          New project
        </Button>
      </DialogTrigger>

      <DialogContent
        title="Create a project"
        description="Project URLs only need to be unique inside this workspace."
      >
        <form
          id="create-project"
          action={formAction}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />

          {state.error ? <FormError>{state.error}</FormError> : null}

          <Field label="Name" error={state.fieldErrors?.name}>
            {(props) => (
              <Input
                {...props}
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Season Opener"
                autoFocus
                required
              />
            )}
          </Field>

          <Field
            label="URL"
            error={state.fieldErrors?.slug}
            hint={
              slug
                ? `/w/${workspaceSlug}/${slug}`
                : "Lowercase letters, numbers, and hyphens."
            }
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
                placeholder="season-opener"
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
            form="create-project"
            type="submit"
            variant="primary"
            size="sm"
            loading={pending}
          >
            Create project
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
