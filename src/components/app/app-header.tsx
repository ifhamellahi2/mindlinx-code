"use client";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { UserMenu } from "@/components/app/user-menu";
import { WorkspaceBadge, type WorkspaceRole } from "@/components/app/workspace-badge";

export function AppHeader({
  workspace,
  user,
}: {
  workspace: { name: string; role: WorkspaceRole };
  user: { name: string; email: string };
}) {
  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border/70 bg-background/95 px-4 backdrop-blur-sm md:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 hidden h-5 sm:block" />
      <div className="min-w-0 flex-1">
        <WorkspaceBadge name={workspace.name} role={workspace.role} />
      </div>
      <UserMenu name={user.name} email={user.email} />
    </header>
  );
}
