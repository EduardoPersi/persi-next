import assert from "node:assert/strict";
import postgres from "postgres";

if (!process.argv.includes("--local")) {
  throw new Error("Este teste exige --local e nunca aceita uma conexão remota.");
}

const localUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const setup = postgres(localUrl, { max: 1, prepare: false });
const first = postgres(localUrl, { max: 1, prepare: false });
const second = postgres(localUrl, { max: 1, prepare: false });

async function createLevel(quantityOnHand) {
  const suffix = crypto.randomUUID();
  const [product] = await setup`
    insert into public.products (name, slug)
    values ('Concurrency test', ${`concurrency-${suffix}`}) returning id
  `;
  const [variant] = await setup`
    insert into public.product_variants (product_id, sku)
    values (${product.id}, ${`CONC-${suffix}`}) returning id
  `;
  const [location] = await setup`
    insert into public.inventory_locations (code, name, status)
    values (${`conc-${suffix}`}, 'Concurrency location', 'active') returning id
  `;
  const [level] = await setup`
    insert into public.inventory_levels (product_variant_id, inventory_location_id, quantity_on_hand)
    values (${variant.id}, ${location.id}, ${quantityOnHand}) returning id
  `;
  return { levelId: level.id, suffix };
}

async function reserve(client, levelId, reference, suffix) {
  const expiry = new Date(Date.now() + 300_000);
  return client`select * from public.reserve_inventory(
    ${levelId}, 1, 'test', ${reference}, ${`${reference}-${suffix}`}, ${expiry}
  )`;
}

try {
  let successfulReservations = 0;
  let expectedRejections = 0;
  let unexpectedErrors = 0;
  let oversellingOccurrences = 0;

  for (let cycle = 1; cycle <= 50; cycle += 1) {
    const { levelId, suffix } = await createLevel(1);
    const results = await Promise.allSettled([
      reserve(first, levelId, `cycle-${cycle}-a`, suffix),
      reserve(second, levelId, `cycle-${cycle}-b`, suffix),
    ]);
    const successes = results.filter((result) => result.status === "fulfilled").length;
    const rejections = results.filter((result) => result.status === "rejected").length;
    successfulReservations += successes;
    expectedRejections += rejections;
    if (successes !== 1 || rejections !== 1) unexpectedErrors += 1;

    const [after] = await setup`
      select quantity_on_hand, quantity_reserved, quantity_available
      from public.inventory_levels where id = ${levelId}
    `;
    if (after.quantity_reserved !== "1" || after.quantity_available !== "0") {
      oversellingOccurrences += 1;
    }
  }

  assert.equal(unexpectedErrors, 0);
  assert.equal(oversellingOccurrences, 0);
  assert.equal(successfulReservations, 50);
  assert.equal(expectedRejections, 50);

  const burstClients = Array.from({ length: 10 }, () => postgres(localUrl, { max: 1, prepare: false }));
  try {
    const { levelId, suffix } = await createLevel(5);
    const burst = await Promise.allSettled(
      burstClients.map((client, index) => reserve(client, levelId, `burst-${index}`, suffix)),
    );
    const burstSuccesses = burst.filter((result) => result.status === "fulfilled").length;
    const burstRejections = burst.filter((result) => result.status === "rejected").length;
    const [afterBurst] = await setup`
      select quantity_on_hand, quantity_reserved, quantity_available
      from public.inventory_levels where id = ${levelId}
    `;
    assert.equal(burstSuccesses, 5);
    assert.equal(burstRejections, 5);
    assert.equal(afterBurst.quantity_on_hand, "5");
    assert.equal(afterBurst.quantity_reserved, "5");
    assert.equal(afterBurst.quantity_available, "0");
  } finally {
    await Promise.all(burstClients.map((client) => client.end()));
  }

  process.stdout.write(
    `Inventory concurrency: cycles=50, successes=${successfulReservations}, expected_rejections=${expectedRejections}, `
      + `unexpected_errors=${unexpectedErrors}, overselling_occurrences=${oversellingOccurrences}; burst=5 success/5 rejection.\n`,
  );
} finally {
  await Promise.all([setup.end(), first.end(), second.end()]);
}
