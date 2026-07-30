import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getInstagramImageSource,
  normalizeInstagramResponse,
} from "../lib/social/instagramCore.ts";

const validImage = {
  id: "123_456",
  caption: "Novidade na Persi #obra",
  media_type: "IMAGE",
  media_product_type: "FEED",
  media_url: "https://cdn.example.com/image.jpg",
  permalink: "https://www.instagram.com/p/example/",
  timestamp: "2026-07-30T12:00:00+0000",
};

test("normaliza somente campos válidos e limita o feed a seis posts", () => {
  const posts = normalizeInstagramResponse({
    data: Array.from({ length: 8 }, (_, index) => ({
      ...validImage,
      id: `post_${index}`,
    })),
  });

  assert.equal(posts.length, 6);
  assert.deepEqual(Object.keys(posts[0]).sort(), [
    "caption",
    "id",
    "mediaType",
    "mediaUrl",
    "permalink",
    "thumbnailUrl",
    "timestamp",
  ]);
});

test("reconhece Reel e usa thumbnail como imagem", () => {
  const [post] = normalizeInstagramResponse({
    data: [
      {
        ...validImage,
        media_type: "VIDEO",
        media_product_type: "REELS",
        thumbnail_url: "https://cdn.example.com/reel.jpg",
      },
    ],
  });

  assert.equal(post.mediaType, "REELS");
  assert.equal(
    getInstagramImageSource(post),
    "https://cdn.example.com/reel.jpg",
  );
});

test("descarta mídia incompleta, URL insegura e timestamp inválido", () => {
  const posts = normalizeInstagramResponse({
    data: [
      { ...validImage, id: undefined },
      { ...validImage, media_url: "http://cdn.example.com/image.jpg" },
      { ...validImage, permalink: "javascript:alert(1)" },
      { ...validImage, timestamp: "data-invalida" },
      null,
    ],
  });

  assert.deepEqual(posts, []);
});

test("segredos permanecem exclusivos do serviço servidor", async () => {
  const [service, feed, card, route] = await Promise.all(
    [
      "../lib/social/instagram.ts",
      "../components/home/InstagramFeed.tsx",
      "../components/home/InstagramCard.tsx",
      "../app/api/instagram/media/[id]/route.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );

  assert.match(service, /import "server-only"/);
  assert.match(service, /INSTAGRAM_ACCESS_TOKEN/);
  assert.match(service, /INSTAGRAM_BUSINESS_ACCOUNT_ID/);
  assert.match(service, /revalidate: INSTAGRAM_REVALIDATE_SECONDS/);
  assert.match(service, /lastSuccessfulMedia/);
  assert.match(service, /INSTAGRAM_ENV_STATUS/);
  assert.match(service, /INSTAGRAM_FETCH_STARTED/);
  assert.match(service, /INSTAGRAM_GRAPH_API_SUCCESS/);
  assert.match(service, /INSTAGRAM_POSTS_RETURNED/);
  assert.match(service, /MISSING_REQUIRED_ENV/);
  assert.equal(feed.includes("process.env"), false);
  assert.equal(card.includes("mediaUrl"), false);
  assert.equal(route.includes("access_token"), false);
});

test("Home carrega feed em Suspense sem bloquear as demais fontes", async () => {
  const home = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(home, /<Suspense fallback={<InstagramSkeleton \/>}>/);
  assert.match(home, /<InstagramFeed \/>/);
  assert.equal(home.includes("getInstagramMedia()"), false);
});
