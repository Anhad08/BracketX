"use server";

import { auth } from "@bracketx/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { toActionState } from "./errors";
import type { ActionState } from "./state";

const credentials = z.object({
  email: z.string().trim().min(1, "Email is required.").pipe(z.email()),
  password: z.string().min(8, "Use at least 8 characters."),
});

const signUpInput = credentials.extend({
  name: z.string().trim().min(1, "Name is required.").max(100),
});

/** Only allow same-origin relative paths — an open redirect otherwise. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/workspaces";
}

export async function signUpAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const destination = safeNext(formData.get("next"));

  try {
    const input = signUpInput.parse({
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
    });

    await auth.api.signUpEmail({
      body: input,
      headers: await headers(),
    });
  } catch (error) {
    return toActionState(error);
  }

  // Outside the try: redirect() signals by throwing, so catching it here would
  // swallow the navigation and report it as an error.
  redirect(destination);
}

export async function signInAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const destination = safeNext(formData.get("next"));

  try {
    const input = credentials.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    await auth.api.signInEmail({
      body: input,
      headers: await headers(),
    });
  } catch (error) {
    // Deliberately not distinguishing "no such user" from "wrong password":
    // that difference lets anyone enumerate which emails have accounts.
    return {
      ...toActionState(error),
      error: "That email and password combination is not correct.",
    };
  }

  redirect(destination);
}

export async function signOutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/");
}
