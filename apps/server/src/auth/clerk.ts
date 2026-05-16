import { verifyToken } from "@clerk/backend";
import { env } from "../env.ts";

export interface VerifiedClerkSession {
  userId: string;
}

export async function verifyClerkSessionToken(
  token: string,
): Promise<VerifiedClerkSession | null> {
  if (!token) return null;
  try {
    const payload = await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY,
    });
    const sub = payload.sub;
    if (typeof sub !== "string" || sub.length === 0) return null;
    return { userId: sub };
  } catch {
    return null;
  }
}
