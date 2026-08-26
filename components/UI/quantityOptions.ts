const SMALL_QUANTITIES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const QUANTITY_TIERS = {
  smallBusiness: [5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 40, 50, 75, 100],
  mediumBusiness: [25, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 250, 500],
  largeBusiness: [100, 150, 200, 300, 350, 400, 500, 1000],
} as const;

function isValidQuantity(quantity: number, minimum: number, maximum: number, step: number) {
  return quantity >= minimum && quantity <= maximum && (quantity - minimum) % step === 0;
}

function getLocalInterval(value: number, step: number) {
  if (value < 25) return step;
  if (value < 100) return Math.max(step, 10);
  if (value < 500) return Math.max(step, 25);
  if (value < 1000) return Math.max(step, 50);
  return Math.max(step, 100);
}

function getLocalQuantities(value: number, step: number) {
  const interval = getLocalInterval(value, step);
  return Array.from({ length: 5 }, (_, index) => value + (index - 2) * interval);
}

function getLargeQuantityAnchors(value: number, maximum: number) {
  const magnitude = 10 ** Math.max(2, Math.floor(Math.log10(value)) - 1);
  const interval = 5 * magnitude;
  const start = Math.max(magnitude, Math.floor(value / interval) * interval);
  const anchors: number[] = [];

  for (let quantity = start; quantity <= maximum && anchors.length < 10; quantity += interval) {
    anchors.push(quantity);
  }

  return anchors;
}

export function getQuantityOptions(value: number, minimum: number, maximum: number, step: number) {
  const normalizedMinimum = Math.max(1, minimum);
  const normalizedMaximum = Math.max(normalizedMinimum, maximum);
  const normalizedStep = Math.max(1, step);

  if (value < 10) {
    const options = SMALL_QUANTITIES.filter((quantity) =>
      isValidQuantity(quantity, normalizedMinimum, normalizedMaximum, normalizedStep),
    );
    if (!options.includes(value)) options.push(value);
    return options.sort((first, second) => first - second);
  }

  const tier = value <= 25
    ? QUANTITY_TIERS.smallBusiness
    : value <= 100
      ? QUANTITY_TIERS.mediumBusiness
      : value <= 500
        ? QUANTITY_TIERS.largeBusiness
        : getLargeQuantityAnchors(value, normalizedMaximum);
  const tierValues: readonly number[] = tier;
  const localQuantities = tierValues.includes(value)
    ? []
    : getLocalQuantities(value, normalizedStep);
  const candidates = new Set<number>([...tierValues, ...localQuantities]);
  const lowerBound = value > 15 && value < 20
    ? 15
    : value <= 100
      ? Math.max(normalizedMinimum, Math.floor(value / 2))
      : Math.max(normalizedMinimum, Math.floor(value * 0.4));
  const options = [...candidates]
    .filter((quantity) =>
      quantity >= lowerBound &&
      isValidQuantity(quantity, normalizedMinimum, normalizedMaximum, normalizedStep),
    )
    .sort((first, second) => first - second);

  if (!options.includes(value)) options.push(value);
  return options.sort((first, second) => first - second);
}
