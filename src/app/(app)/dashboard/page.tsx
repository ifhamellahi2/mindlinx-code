import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Info, Mail, Search, Target } from "lucide-react";
import {
  getWorkspaceContext,
  listWorkspaceMemberships,
  type WorkspaceContext,
} from "@/lib/auth-context";
import { UnauthorizedError } from "@/lib/auth-errors";
import { getBusinessProfile } from "@/lib/business-profile/repository";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Dashboard — MindLinx",
  description: "Your MindLinx workspace.",
};

// The page reads the session via headers(), so it cannot prerender instantly.
export const instant = false;

const upcomingSteps = [
  {
    icon: Target,
    title: "Define your ideal customer",
    description:
      "Turn your positioning into a clear ideal customer profile with firmographics, pains, and buying triggers.",
  },
  {
    icon: Search,
    title: "Discover and qualify prospects",
    description:
      "Surface accounts that match your profile, then qualify them with evidence instead of guesswork.",
  },
  {
    icon: Mail,
    title: "Prepare personalized outreach",
    description:
      "Draft outreach grounded in each prospect's context, ready for your team to review and send.",
  },
];

export default async function DashboardPage() {
  let context: WorkspaceContext;
  try {
    // Re-resolved on the server from the verified session; no client-supplied
    // id is ever used to pick a workspace.
    context = await getWorkspaceContext();
  } catch (error) {
    // The layout also guards. Redirecting here keeps the parallel page render
    // from logging a server error before the layout redirect wins.
    if (error instanceof UnauthorizedError) redirect("/sign-in");
    throw error;
  }

  const memberships = await listWorkspaceMemberships(context.userId);
  const workspace = memberships.find((item) => item.workspaceId === context.workspaceId);

  // Direct repository read scoped to the session-resolved workspace, so no
  // other tenant's profile can appear here. A failed read propagates to the
  // framework error page rather than rendering a misleading "not started".
  const profile = await getBusinessProfile(context.workspaceId);
  const isComplete = profile?.completedAt != null;

  const businessState = !profile
    ? {
        status: "Not started",
        heading: "Set up your business",
        description:
          "Tell MindLinx what your business does so we can prepare your customer acquisition workspace.",
        cta: "Set up business",
      }
    : isComplete
      ? {
          status: "Completed",
          heading: "Your business profile is ready",
          description:
            "Your business information is saved. You can review or update it anytime.",
          cta: "View business profile",
        }
      : {
          status: "Draft",
          heading: "Continue setting up your business",
          description: "Your business profile is saved as a draft. Complete it when you're ready.",
          cta: "Continue setup",
        };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 md:p-8">
      <section className="rounded-2xl border border-border/70 bg-card p-6 md:p-8">
        <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          {workspace?.name ?? "Your workspace"}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance text-foreground md:text-3xl">
          Welcome to MindLinx
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Your workspace is ready. MindLinx brings your business context, ideal customer profile,
          prospect discovery, and personalized outreach into one focused workflow.
        </p>
      </section>

      <div className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Getting started</h2>
          <p className="text-xs text-muted-foreground">
            Business profile is live · remaining steps coming soon
          </p>
        </div>

        <section className="rounded-2xl border border-border/70 bg-card p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Building2 className="size-4" aria-hidden="true" />
              Business profile
            </div>
            <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {businessState.status}
            </span>
          </div>

          <h3 className="mt-4 text-xl font-semibold tracking-tight text-foreground md:text-2xl">
            {businessState.heading}
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {businessState.description}
          </p>
          {isComplete && profile ? (
            <p className="mt-3 text-sm text-foreground">
              <span className="text-muted-foreground">Business name: </span>
              {profile.name}
            </p>
          ) : null}

          <Button asChild size="lg" className="mt-5 h-10">
            <Link href="/onboarding">{businessState.cta}</Link>
          </Button>
        </section>

        <ol className="grid gap-4 sm:grid-cols-2">
          {upcomingSteps.map((step, index) => (
            <li key={step.title} className="rounded-xl border border-border/70 bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-sm font-medium text-primary">
                  {index + 2}
                </span>
                <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Coming soon
                </span>
              </div>
              <h4 className="mt-4 flex items-center gap-2 text-sm font-medium text-foreground">
                <step.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                {step.title}
              </h4>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-secondary/40 p-4 text-sm leading-6 text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          The business profile is the first live step. The remaining steps are previews only — no
          prospects, campaigns, or outreach are created yet.
        </p>
      </div>
    </div>
  );
}
