import { Building2, LayoutDashboard, type LucideIcon } from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

// Only routes that exist. Add entries here as features ship.
export const primaryNavItems: NavItem[] = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Business Profile",
    href: "/onboarding",
    icon: Building2,
  },
];
