const SURROUNDING_QUANTITY_COUNT = 5;

export function getQuantityOptions(
  value: number,
  minimum: number,
  maximum: number,
  step: number,
) {
  const normalizedMinimum = Math.max(1, minimum);
  const normalizedMaximum = Math.max(normalizedMinimum, maximum);
  const normalizedStep = Math.max(1, step);
  const options: number[] = [];

  for (
    let offset = -SURROUNDING_QUANTITY_COUNT;
    offset <= SURROUNDING_QUANTITY_COUNT;
    offset += 1
  ) {
    const quantity = value + offset * normalizedStep;
    if (quantity < normalizedMinimum || quantity > normalizedMaximum) continue;
    if ((quantity - normalizedMinimum) % normalizedStep !== 0) continue;
    options.push(quantity);
  }

  if (!options.includes(value)) options.push(value);
  return options.sort((first, second) => first - second);
}
