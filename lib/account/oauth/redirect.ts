import { NextResponse } from "next/server";
import { getPrivateAccountHeaders } from "../responsePolicy.ts";
export { getSafeOAuthOrigin } from "./utils.ts";

export function createOAuthRedirect(
  origin: string,
  path: string,
): NextResponse {
  const base = new URL(origin);
  if (
    base.protocol !== "https:" ||
    base.origin !== origin ||
    !path.startsWith("/") ||
    path.startsWith("//")
  ) {
    throw new Error("Invalid OAuth redirect");
  }

  return NextResponse.redirect(new URL(path, base), {
    headers: getPrivateAccountHeaders(),
  });
}
