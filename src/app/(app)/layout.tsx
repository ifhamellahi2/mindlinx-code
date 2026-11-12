import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app/app-header";
import { AppSidebar } from "@/components/app/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ensureWorkspaceContextForUser,
  getSessionFromHeaders,
  listWorkspaceMemberships,
  type WorkspaceContext,
} from "@/lib/auth-context";
import {
  UnauthorizedError,
  WorkspaceNotProvisionedError,
  WorkspaceSelectionRequiredError,
} from "@/lib/auth-errors";

// The layout reads the session cookie, so this segment cannot be prerendered
// for instant navigation.
export const instant = false;

function WorkspaceState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
        <span className="size-2 rounded-full bg-gold" aria-hidden="true" />
        MindLinx
      </div>
      <div className="max-w-sm space-y-2">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Only the verified session identifies the user; nothing is read from params
  // or client state.
  const session = await getSessionFromHeaders(await headers());
  if (!session) redirect("/sign-in");

  let context: WorkspaceContext;
  try {
    // Same core as ensureWorkspaceContext(), but the session above is already
    // verified, so this avoids a second session lookup.
    context = await ensureWorkspaceContextForUser(session.user.id);
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect("/sign-in");
    if (error instanceof WorkspaceSelectionRequiredError) {
      return (
        <WorkspaceState
          title="Workspace selection required"
          description="Your account belongs to more than one workspace. Ask an administrator to assign the workspace you should use; switching workspaces is not available yet."
        />
      );
    }
    if (error instanceof WorkspaceNotProvisionedError) {
      return (
        <WorkspaceState
          title="Workspace unavailable"
          description="Your workspace is no longer available. Contact your administrator to restore access."
        />
      );
    }
    throw error;
  }

  const memberships = await listWorkspaceMemberships(session.user.id);
  const workspace = memberships.find((item) => item.workspaceId === context.workspaceId);

  if (!workspace) {
    return (
      <WorkspaceState
        title="Workspace unavailable"
        description="Your workspace is no longer available. Contact your administrator to restore access."
      />
    );
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <AppHeader
            workspace={{ name: workspace.name, role: workspace.role }}
            user={{ name: session.user.name, email: session.user.email }}
          />
          <div className="flex flex-1 flex-col">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
