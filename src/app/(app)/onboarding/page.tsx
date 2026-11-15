import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  getWorkspaceContext,
  listWorkspaceMemberships,
} from "@/lib/auth-context";
import { UnauthorizedError } from "@/lib/auth-errors";
import { BusinessProfileForm } from "@/components/onboarding/business-profile-form";

export const metadata: Metadata = {
  title: "Set up your business — MindLinx",
  description:
    "Tell MindLinx about your business so your workspace is ready for ideal customer profiles and outreach.",
};

// The page reads the session via headers(), so it cannot prerender instantly.
export const instant = false;

export default async function OnboardingPage() {
  let workspaceName: string | undefined;
  try {
    // Re-resolved on the server from the verified session; no client-supplied
    // id is ever used to pick a workspace.
    const context = await getWorkspaceContext();
    const memberships = await listWorkspaceMemberships(context.userId);
    workspaceName = memberships.find(
      (item) => item.workspaceId === context.workspaceId,
    )?.name;
  } catch (error) {
    // The layout also guards. Redirecting here keeps the parallel page render
    // from logging a server error before the layout redirect wins.
    if (error instanceof UnauthorizedError) redirect("/sign-in");
    throw error;
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:p-8">
      <BusinessProfileForm workspaceName={workspaceName ?? "Your workspace"} />
    </div>
  );
}
