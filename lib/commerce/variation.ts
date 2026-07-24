import type { ProductVariation } from "@/types/product";

export type SelectedAttributes = Record<string, string>;

function normalizeAttribute(value: string) {
  return decodeURIComponent(value)
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replace(/^attribute_/, "");
}

export function resolveSelectedVariation(
  variations: ProductVariation[],
  selectedAttributes: SelectedAttributes,
): ProductVariation | null {
  const selections = Object.entries(selectedAttributes).filter(
    ([, value]) => value.trim().length > 0,
  );

  if (selections.length === 0) return null;

  return (
    variations.find((variation) => {
      if (variation.attributes.length !== selections.length) return false;

      return variation.attributes.every((attribute) => {
        const selectedValue = selections.find(
          ([name]) =>
            normalizeAttribute(name) === normalizeAttribute(attribute.name),
        )?.[1];

        return (
          selectedValue !== undefined &&
          normalizeAttribute(selectedValue) ===
            normalizeAttribute(attribute.value)
        );
      });
    }) ?? null
  );
}

export function canAttributeOptionMatch(
  variations: ProductVariation[],
  selectedAttributes: SelectedAttributes,
  attributeName: string,
  optionValue: string,
) {
  const candidateSelections = {
    ...selectedAttributes,
    [attributeName]: optionValue,
  };

  return variations.some((variation) =>
    Object.entries(candidateSelections).every(([name, value]) => {
      if (!value) return true;

      return variation.attributes.some(
        (attribute) =>
          normalizeAttribute(attribute.name) === normalizeAttribute(name) &&
          normalizeAttribute(attribute.value) === normalizeAttribute(value),
      );
    }),
  );
}
