"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BusinessProfileDetails } from "@/lib/business-profile/validation";

type FieldKey =
  | "name"
  | "website"
  | "industry"
  | "description"
  | "details.targetCustomers"
  | "details.geographies"
  | "details.differentiators"
  | "details.goals";

type FieldErrors = Partial<Record<FieldKey, string>>;

// Mirrors the DTO returned by GET/PUT /api/business-profile.
type Profile = {
  name: string;
  website: string | null;
  industry: string | null;
  description: string | null;
  details: BusinessProfileDetails;
  completedAt: string | null;
  updatedAt: string;
};

const FIELD_KEYS: readonly FieldKey[] = [
  "name",
  "website",
  "industry",
  "description",
  "details.targetCustomers",
  "details.geographies",
  "details.differentiators",
  "details.goals",
];

function isFieldKey(key: string): key is FieldKey {
  return (FIELD_KEYS as readonly string[]).includes(key);
}

type FormValues = {
  name: string;
  website: string;
  industry: string;
  description: string;
  targetCustomers: string;
  geographies: string;
  differentiators: string;
  goals: string;
};

const EMPTY_VALUES: FormValues = {
  name: "",
  website: "",
  industry: "",
  description: "",
  targetCustomers: "",
  geographies: "",
  differentiators: "",
  goals: "",
};

// The workspace name reads like "ifham's workspace"; strip that suffix to
// suggest a business name. An empty result keeps the field empty.
function suggestedBusinessName(workspaceName: string) {
  return workspaceName.replace(/['’]s workspace$/i, "").trim();
}

// The optimistic token is displayed with a Date but always sent back as the
// exact string received — a round-trip through Date would drop microseconds.
function formatDate(token: string) {
  const date = new Date(token);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const WORKSPACE_ERRORS: Record<string, string> = {
  WorkspaceSelectionRequiredError:
    "Your account belongs to multiple workspaces, so MindLinx can't tell which one to save into. Workspace selection is coming soon.",
  WorkspaceNotFoundError: "We couldn't find an active workspace for your account.",
  WorkspaceNotProvisionedError: "We couldn't find an active workspace for your account.",
};

const LOAD_FAILED_MESSAGE = "We couldn't load your business profile. Please try again.";
const OFFLINE_MESSAGE =
  "We couldn't reach the server. Check your connection and try again.";

type LoadResult =
  | { kind: "profile"; profile: Profile }
  | { kind: "empty" }
  | { kind: "redirect" }
  | { kind: "failed"; message: string };

export function BusinessProfileForm({ workspaceName }: { workspaceName: string }) {
  const router = useRouter();
  const suggestedName = suggestedBusinessName(workspaceName);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [hasProfile, setHasProfile] = useState(false);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<"draft" | "complete" | null>(null);

  const isComplete = completedAt !== null;

  const applyProfile = useCallback((profile: Profile) => {
    setValues({
      name: profile.name,
      website: profile.website ?? "",
      industry: profile.industry ?? "",
      description: profile.description ?? "",
      targetCustomers: profile.details.targetCustomers ?? "",
      geographies: profile.details.geographies ?? "",
      differentiators: profile.details.differentiators ?? "",
      goals: profile.details.goals ?? "",
    });
    setHasProfile(true);
    setCompletedAt(profile.completedAt);
    setToken(profile.updatedAt);
  }, []);

  // Pure fetcher: no state updates, so it is safe to call from the mount
  // effect. All state changes happen in applyResult's callbacks.
  const fetchProfile = useCallback(async (): Promise<LoadResult> => {
    try {
      const response = await fetch("/api/business-profile", {
        headers: { accept: "application/json" },
      });

      if (response.status === 401) return { kind: "redirect" };
      if (!response.ok) return { kind: "failed", message: LOAD_FAILED_MESSAGE };

      const body = (await response.json()) as { profile: Profile | null };
      return body.profile ? { kind: "profile", profile: body.profile } : { kind: "empty" };
    } catch {
      return { kind: "failed", message: OFFLINE_MESSAGE };
    }
  }, []);

  const applyResult = useCallback(
    (result: LoadResult) => {
      // The only place loading ends; the initial render shows the loading card.
      setLoading(false);

      if (result.kind === "redirect") {
        router.replace("/sign-in");
        router.refresh();
        return;
      }

      if (result.kind === "failed") {
        setLoadError(result.message);
        return;
      }

      if (result.kind === "profile") {
        applyProfile(result.profile);
      } else {
        // Not started: suggest a name but never save one automatically.
        setValues({ ...EMPTY_VALUES, name: suggestedName });
        setHasProfile(false);
        setCompletedAt(null);
        setToken(null);
      }
      setLoadError(null);
      setConflict(false);
    },
    [applyProfile, router, suggestedName],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchProfile().then((result) => {
      if (!cancelled) applyResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchProfile, applyResult]);

  function reloadProfile() {
    setNotice(null);
    void fetchProfile().then(applyResult);
  }

  async function save(complete: boolean) {
    setFieldErrors({});
    setFormError(null);
    setNotice(null);
    setConflict(false);

    const errors: FieldErrors = {};
    if (!values.name.trim()) errors.name = "Business name is required.";
    if (complete && !values.description.trim()) {
      errors.description = "Describe what you sell to complete setup.";
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSaving(complete ? "complete" : "draft");
    let response: Response;
    try {
      response = await fetch("/api/business-profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          website: values.website,
          industry: values.industry,
          description: values.description,
          details: {
            targetCustomers: values.targetCustomers,
            geographies: values.geographies,
            differentiators: values.differentiators,
            goals: values.goals,
          },
          complete,
          expectedUpdatedAt: token,
        }),
      });
    } catch {
      setSaving(null);
      setFormError(
        "We couldn't reach the server. Check your connection and try again — your changes are still in the form.",
      );
      return;
    }
    setSaving(null);

    if (response.ok) {
      const body = (await response.json()) as { profile: Profile };
      applyProfile(body.profile);
      if (complete) {
        router.replace("/dashboard");
        router.refresh();
      } else {
        setNotice("Draft saved. You can come back and finish anytime.");
      }
      return;
    }

    if (response.status === 401) {
      router.replace("/sign-in");
      router.refresh();
      return;
    }

    if (response.status === 409) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (body?.error === "BusinessProfileConflictError") {
        setConflict(true);
      } else {
        setFormError(
          WORKSPACE_ERRORS[body?.error ?? ""] ??
            "We couldn't save your changes. Please try again.",
        );
      }
      return;
    }

    if (response.status === 400) {
      const body = (await response.json().catch(() => null)) as {
        fields?: Record<string, string>;
      } | null;

      const mapped: FieldErrors = {};
      for (const [key, message] of Object.entries(body?.fields ?? {})) {
        if (isFieldKey(key)) mapped[key] = message;
      }
      if (Object.keys(mapped).length > 0) {
        setFieldErrors(mapped);
      } else {
        setFormError("Please check your entries and try again.");
      }
      return;
    }

    if (response.status === 413) {
      setFormError(
        "Your changes are too large to save. Shorten the longest fields and try again.",
      );
      return;
    }

    setFormError("We couldn't save your changes. Please try again.");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(true);
  }

  const busy = loading || saving !== null;

  function fieldProps(id: string, key: FieldKey) {
    return {
      id,
      disabled: busy,
      "aria-invalid": (fieldErrors[key] ? true : undefined) as boolean | undefined,
      "aria-describedby": fieldErrors[key] ? `${id}-error` : undefined,
    };
  }

  function fieldError(id: string, key: FieldKey) {
    const message = fieldErrors[key];
    return message ? (
      <p id={`${id}-error`} className="text-sm text-destructive">
        {message}
      </p>
    ) : null;
  }

  if (loading) {
    return (
      <p className="rounded-2xl border border-border/70 bg-card p-6 text-sm text-muted-foreground">
        Loading your business profile…
      </p>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card p-6">
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <p className="flex-1">{loadError}</p>
          <Button type="button" variant="outline" size="sm" onClick={reloadProfile}>
            <RotateCw aria-hidden="true" />
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          Getting started
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance text-foreground md:text-3xl">
          Tell us about your business
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          These details set up your MindLinx workspace for ideal customer profiles and
          outreach later. Everything stays editable, and nothing is shared outside your
          workspace.
        </p>
      </header>

      {conflict ? (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="flex-1 space-y-2">
            <p>
              This profile was changed elsewhere since you opened the page. Your changes
              weren&apos;t saved, and nothing was overwritten.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={reloadProfile}
            >
              <RotateCw aria-hidden="true" />
              Load the latest version
            </Button>
          </div>
        </div>
      ) : null}

      {formError ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{formError}</p>
        </div>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-border/70 bg-secondary/40 px-3 py-2.5 text-sm text-foreground"
        >
          <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
          {notice}
        </p>
      ) : null}

      <section className="rounded-2xl border border-border/70 bg-card p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">Business basics</h2>
          <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {isComplete
              ? `Completed ${formatDate(completedAt ?? "")}`
              : hasProfile
                ? `Draft · saved ${formatDate(token ?? "")}`
                : "Not started"}
          </span>
        </div>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="business-name">
              <span>
                Business name{" "}
                <span aria-hidden="true" className="text-destructive">
                  *
                </span>
                <span className="sr-only">(required)</span>
              </span>
            </Label>
            <Input
              type="text"
              autoComplete="organization"
              placeholder="e.g. Acme Analytics"
              className="h-10"
              {...fieldProps("business-name", "name")}
              value={values.name}
              onChange={(event) =>
                setValues((current) => ({ ...current, name: event.target.value }))
              }
            />
            {!hasProfile && suggestedName ? (
              <p className="text-sm text-muted-foreground">
                We suggested your workspace name — edit it freely. Nothing is saved until
                you choose Save draft or Complete setup.
              </p>
            ) : null}
            {fieldError("business-name", "name")}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="website">Website</Label>
              <Input
                type="text"
                inputMode="url"
                autoComplete="url"
                placeholder="example.com"
                className="h-10"
                {...fieldProps("website", "website")}
                value={values.website}
                onChange={(event) =>
                  setValues((current) => ({ ...current, website: event.target.value }))
                }
              />
              {fieldError("website", "website")}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="industry">Industry</Label>
              <Input
                type="text"
                placeholder="e.g. B2B SaaS, manufacturing, consulting"
                className="h-10"
                {...fieldProps("industry", "industry")}
                value={values.industry}
                onChange={(event) =>
                  setValues((current) => ({ ...current, industry: event.target.value }))
                }
              />
              {fieldError("industry", "industry")}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card p-6">
        <h2 className="text-base font-semibold text-foreground">What you sell</h2>
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="description">
            <span>
              What do you sell, and what problem does it solve?{" "}
              <span aria-hidden="true" className="text-destructive">
                *
              </span>
              <span className="sr-only">(required to complete setup)</span>
            </span>
          </Label>
          <Textarea
            rows={5}
            placeholder="e.g. We help e-commerce brands recover abandoned carts with automated email journeys."
            {...fieldProps("description", "description")}
            value={values.description}
            onChange={(event) =>
              setValues((current) => ({ ...current, description: event.target.value }))
            }
          />
          <p className="text-sm text-muted-foreground">
            One or two sentences is enough. Required to complete setup — you can save a
            draft without it.
          </p>
          {fieldError("description", "description")}
        </div>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card p-6">
        <h2 className="text-base font-semibold text-foreground">
          Your customers and positioning
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Optional — more context helps MindLinx later, but you can leave any of these
          blank.
        </p>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="target-customers">Target customers</Label>
            <Textarea
              rows={2}
              placeholder="e.g. Early-stage B2B startups in North America"
              {...fieldProps("target-customers", "details.targetCustomers")}
              value={values.targetCustomers}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  targetCustomers: event.target.value,
                }))
              }
            />
            {fieldError("target-customers", "details.targetCustomers")}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="geographies">Geographic markets</Label>
            <Textarea
              rows={2}
              placeholder="e.g. United States and Canada"
              {...fieldProps("geographies", "details.geographies")}
              value={values.geographies}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  geographies: event.target.value,
                }))
              }
            />
            {fieldError("geographies", "details.geographies")}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="differentiators">Differentiators</Label>
            <Textarea
              rows={2}
              placeholder="e.g. Implementation in days, not months"
              {...fieldProps("differentiators", "details.differentiators")}
              value={values.differentiators}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  differentiators: event.target.value,
                }))
              }
            />
            {fieldError("differentiators", "details.differentiators")}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="goals">Customer acquisition goals</Label>
            <Textarea
              rows={2}
              placeholder="e.g. Book 20 qualified demos per month"
              {...fieldProps("goals", "details.goals")}
              value={values.goals}
              onChange={(event) =>
                setValues((current) => ({ ...current, goals: event.target.value }))
              }
            />
            {fieldError("goals", "details.goals")}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" className="h-10" disabled={busy}>
          {saving === "complete" ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" />
              Saving…
            </>
          ) : isComplete ? (
            "Save changes"
          ) : (
            "Complete setup"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-10"
          disabled={busy}
          onClick={() => void save(false)}
        >
          {saving === "draft" ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" />
              Saving…
            </>
          ) : isComplete ? (
            "Save as draft"
          ) : (
            "Save draft"
          )}
        </Button>
      </div>
    </form>
  );
}
