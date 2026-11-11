import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldCheck, Target, Users } from "lucide-react";
import { getSessionFromHeaders } from "@/lib/auth-context";

// The layout reads the session cookie, so this segment cannot be prerendered
// for instant navigation.
export const instant = false;

const highlights = [
  {
    icon: Target,
    title: "Signal-based prioritization",
    description: "Focus your team on the accounts most likely to convert.",
  },
  {
    icon: Users,
    title: "Built for revenue teams",
    description: "Shared workspaces keep pipeline and context in one place.",
  },
  {
    icon: ShieldCheck,
    title: "Secure by default",
    description: "Verified sessions with workspace-scoped access.",
  },
];

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionFromHeaders(await headers());
  if (session) redirect("/dashboard");

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b border-border/70">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground"
          >
            <span className="size-2 rounded-full bg-gold" aria-hidden="true" />
            MindLinx
          </Link>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 px-6 lg:grid-cols-2">
        <section className="hidden flex-col justify-center gap-10 py-16 lg:flex lg:pr-12">
          <div className="space-y-4">
            <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
              Autonomous customer acquisition
            </p>
            <h2 className="max-w-md text-3xl font-semibold tracking-tight text-balance text-foreground">
              Turn market signals into qualified pipeline.
            </h2>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              MindLinx monitors the market, surfaces the accounts worth pursuing, and gives your
              team the next best action.
            </p>
          </div>

          <ul className="space-y-5">
            {highlights.map(({ icon: Icon, title, description }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">{title}</p>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex items-center justify-center border-border/70 py-12 lg:border-l lg:pl-12">
          <div className="w-full max-w-sm">{children}</div>
        </section>
      </main>
    </div>
  );
}
