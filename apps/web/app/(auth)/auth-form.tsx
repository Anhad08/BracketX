"use client";

import {
  Button,
  Field,
  FormError,
  Input,
  Surface,
  SurfaceBody,
} from "@bracketx/ui";
import Link from "next/link";
import { useActionState } from "react";

import { idle, type ActionState } from "../actions/state";

type Mode = "sign-in" | "sign-up";

export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: Mode;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(action, idle);
  const isSignUp = mode === "sign-up";

  return (
    <Surface>
      <SurfaceBody className="p-6">
        <div className="mb-6 flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold text-fg">
            {isSignUp ? "Create your account" : "Sign in"}
          </h1>
          <p className="text-sm text-fg-muted">
            {isSignUp
              ? "You will set up your first workspace next."
              : "Welcome back."}
          </p>
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          {next ? <input type="hidden" name="next" value={next} /> : null}

          {state.error ? <FormError>{state.error}</FormError> : null}

          {isSignUp ? (
            <Field label="Name" error={state.fieldErrors?.name}>
              {(props) => (
                <Input
                  {...props}
                  name="name"
                  autoComplete="name"
                  placeholder="Alex Rivera"
                  required
                />
              )}
            </Field>
          ) : null}

          <Field label="Email" error={state.fieldErrors?.email}>
            {(props) => (
              <Input
                {...props}
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            )}
          </Field>

          <Field
            label="Password"
            error={state.fieldErrors?.password}
            hint={isSignUp ? "At least 8 characters." : undefined}
          >
            {(props) => (
              <Input
                {...props}
                name="password"
                type="password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                required
              />
            )}
          </Field>

          <Button type="submit" variant="primary" loading={pending}>
            {isSignUp ? "Create account" : "Sign in"}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-fg-muted">
          {isSignUp ? "Already have an account? " : "No account yet? "}
          <Link
            href={isSignUp ? "/sign-in" : "/sign-up"}
            className="text-accent underline-offset-4 hover:underline"
          >
            {isSignUp ? "Sign in" : "Create one"}
          </Link>
        </p>
      </SurfaceBody>
    </Surface>
  );
}
