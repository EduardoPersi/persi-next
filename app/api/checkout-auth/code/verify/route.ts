import { handleCheckoutIdentityRequest } from "@/lib/checkout-auth/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export const POST = (request: Request) =>
  handleCheckoutIdentityRequest(request, "code-verify");
