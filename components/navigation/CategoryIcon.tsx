import type { LucideIcon } from "lucide-react";
import {
  Bath,
  BrickWall,
  Droplets,
  Grid3X3,
  Hammer,
  HardHat,
  PackageOpen,
  PaintRoller,
  PanelsTopLeft,
  Shield,
  Waves,
  Wrench,
  Zap,
} from "lucide-react";

const ICON_RULES: Array<[RegExp, LucideIcon]> = [
  [/hidr|água|agua|tubo|conex|bomba|poço|poco/, Droplets],
  [/elétr|eletr|ilumina|cabo|tomada/, Zap],
  [/banheiro|cozinha|louça|louca|sanit/, Bath],
  [/ferrament/, Wrench],
  [/ferragem|parafuso|fixaç|fixac/, Hammer],
  [/tinta|pintura|verniz/, PaintRoller],
  [/imperme|vedação|vedacao/, Shield],
  [/piscina/, Waves],
  [/drywall|forro|steel frame/, PanelsTopLeft],
  [/construç|construc|obra|alvenaria/, BrickWall],
  [/epi|segurança|seguranca/, HardHat],
  [/acabamento|revestimento|piso/, Grid3X3],
];

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function CategoryIcon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  const normalizedName = normalize(name);
  const Icon = ICON_RULES.find(([pattern]) => pattern.test(normalizedName))?.[1] ?? PackageOpen;
  return <Icon className={className} strokeWidth={1.7} aria-hidden="true" />;
}
