interface IdentifiableItem {
  id: number;
}

export function getCircularAdjacentItems<T extends IdentifiableItem>(
  items: readonly T[],
  currentId: number,
): { previous: T; next: T } | undefined {
  const uniqueItems = [
    ...new Map(items.map((item) => [item.id, item])).values(),
  ];
  if (uniqueItems.length < 2) return undefined;

  const currentIndex = uniqueItems.findIndex((item) => item.id === currentId);
  if (currentIndex < 0) return undefined;

  return {
    previous:
      uniqueItems[
        (currentIndex - 1 + uniqueItems.length) % uniqueItems.length
      ],
    next: uniqueItems[(currentIndex + 1) % uniqueItems.length],
  };
}
