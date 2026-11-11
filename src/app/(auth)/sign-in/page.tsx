import type { Metadata } from "next";
import Link from "next/link";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Sign in — MindLinx",
  description: "Sign in to your MindLinx workspace.",
};

export default function SignInPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to continue to your workspace.</p>
      </div>

      <Card className="[--card-spacing:--spacing(6)] shadow-sm">
        <CardContent>
          <SignInForm />
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        New to MindLinx?{" "}
        <Link
          href="/sign-up"
          className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
