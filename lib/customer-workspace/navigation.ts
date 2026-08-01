import {
  Bell,
  BellRing,
  Eye,
  Heart,
  LayoutDashboard,
  Link2,
  MapPin,
  Package,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export interface CustomerWorkspaceNavigationItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const CUSTOMER_WORKSPACE_NAVIGATION: CustomerWorkspaceNavigationItem[] = [
  { href: "/minha-conta", label: "Dashboard", icon: LayoutDashboard },
  { href: "/minha-conta/pedidos", label: "Pedidos", icon: Package },
  { href: "/minha-conta/enderecos", label: "Endereços", icon: MapPin },
  { href: "/minha-conta/perfil", label: "Perfil", icon: UserRound },
  { href: "/minha-conta/listas", label: "Minhas listas", icon: Heart },
  { href: "/minha-conta/lista-espera", label: "Lista de espera", icon: BellRing },
  { href: "/minha-conta/produtos-vistos", label: "Produtos vistos", icon: Eye },
  { href: "/minha-conta/contas-conectadas", label: "Contas conectadas", icon: Link2 },
  { href: "/minha-conta/notificacoes", label: "Notificações", icon: Bell },
];

export function isCustomerWorkspaceItemActive(pathname: string, href: string) {
  return href === "/minha-conta"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}
