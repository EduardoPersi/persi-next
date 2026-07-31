import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getProductHref } from "@/lib/routing/storefrontUrls";

export function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  return params.then(({ slug }) => {
    const destination = request.nextUrl.clone();
    destination.pathname = getProductHref(slug);
    return NextResponse.redirect(destination, 301);
  });
}
