import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { OAuthError } from "./errors.ts";

export function generateOAuthValue(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function createOAuthPkce(): {
  codeChallenge: string;
  codeVerifier: string;
} {
  const codeVerifier = generateOAuthValue(48);
  return {
    codeVerifier,
    codeChallenge: createHash("sha256")
      .update(codeVerifier, "ascii")
      .digest("base64url"),
  };
}

export function safeOAuthEqual(
  received: string,
  expected: string,
): boolean {
  const receivedBuffer = Buffer.from(received, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

export function validateOAuthCallbackInput(input: {
  code: string;
  codeVerifier: string;
  expectedState: string;
  nonce: string;
  state: string;
}): void {
  if (
    !input.code ||
    input.code.length > 4_096 ||
    !input.state ||
    !input.expectedState ||
    !safeOAuthEqual(input.state, input.expectedState) ||
    !/^[A-Za-z0-9_-]{20,128}$/.test(input.nonce) ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(input.codeVerifier)
  ) {
    throw new OAuthError(
      400,
      "OAUTH_STATE_INVALID",
      "Invalid OAuth callback",
    );
  }
}
