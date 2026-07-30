import { auth } from "@bracketx/auth";
import { toNextJsHandler } from "better-auth/next-js";

/**
 * Better Auth's own endpoints (sign-in, sign-up, sign-out, session,
 * organization management). Everything under /api/auth/* is handled here.
 */
export const { GET, POST } = toNextJsHandler(auth.handler);
