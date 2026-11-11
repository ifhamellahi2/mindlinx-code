import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Create an account — MindLinx",
  description: "Create your MindLinx account.",
};

export default function SignUpPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          Start turning market signals into qualified pipeline.
        </p>
      </div>

      <Card className="[--card-spacing:--spacing(6)] shadow-sm">
        <CardContent>
          <SignUpForm />
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
