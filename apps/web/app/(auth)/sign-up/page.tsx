import type { Metadata } from "next";

import { signUpAction } from "../../actions/auth";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthForm mode="sign-up" action={signUpAction} next={next} />;
}
