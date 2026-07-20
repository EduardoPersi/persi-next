import { NextResponse } from "next/server";
import {
  INSTAGRAM_REVALIDATE_SECONDS,
} from "@/services/instagram/client";
import {
  getInstagramImageSource,
  getInstagramMedia,
} from "@/services/instagram/media";

interface InstagramMediaRouteProps {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: Request,
  { params }: InstagramMediaRouteProps,
) {
  const { id } = await params;

  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
    return NextResponse.json(
      { message: "Mídia inválida." },
      { status: 400 },
    );
  }

  const media = (await getInstagramMedia()).find((item) => item.id === id);
  const source = media ? getInstagramImageSource(media) : undefined;

  if (!source) {
    return NextResponse.json(
      { message: "Mídia não encontrada." },
      { status: 404 },
    );
  }

  try {
    const response = await fetch(source, {
      next: { revalidate: INSTAGRAM_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(10_000),
    });
    const contentType = response.headers.get("content-type") ?? "";

    if (!response.ok || !contentType.startsWith("image/")) {
      throw new Error();
    }

    return new NextResponse(await response.arrayBuffer(), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": `public, max-age=${INSTAGRAM_REVALIDATE_SECONDS}, stale-while-revalidate=86400`,
      },
    });
  } catch {
    return NextResponse.json(
      { message: "Não foi possível carregar a mídia." },
      { status: 502 },
    );
  }
}
