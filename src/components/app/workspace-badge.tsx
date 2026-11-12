import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkspaceRole = "owner" | "admin" | "member";

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export function WorkspaceBadge({
  name,
  role,
  className,
}: {
  name: string;
  role: WorkspaceRole;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Building2 className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{ROLE_LABELS[role]}</p>
      </div>
    </div>
  );
}
