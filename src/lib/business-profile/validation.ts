import { z } from "zod";

// Shared by the onboarding form and the API, so this module must stay free of
// `server-only` and database imports.

export const BUSINESS_PROFILE_LIMITS = {
  name: 120,
  website: 2048,
  industry: 120,
  description: 4000,
  targetCustomers: 2000,
  geographies: 500,
  differentiators: 2000,
  goals: 1000,
} as const;

export type BusinessProfileDetails = {
  targetCustomers: string | null;
  geographies: string | null;
  differentiators: string | null;
  goals: string | null;
};

export const EMPTY_DETAILS: BusinessProfileDetails = {
  targetCustomers: null,
  geographies: null,
  differentiators: null,
  goals: null,
};

export type BusinessProfileInput = {
  name: string;
  website: string | null;
  industry: string | null;
  description: string | null;
  details: BusinessProfileDetails;
  complete: boolean;
  /** Exact `updatedAt` token returned by a previous read/write, or null to create. */
  expectedUpdatedAt: string | null;
};

export type BusinessProfileValidation =
  | { ok: true; data: BusinessProfileInput }
  | { ok: false; fields: Record<string, string> };

// Tab and newline survive; other C0 controls and DEL are removed. CRLF is
// normalised first so pasted text keeps its paragraph breaks.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, "").trim();
}

function textField(max: number, label: string) {
  return z
    .string({ message: `${label} must be text.` })
    .transform(normalizeText)
    .pipe(z.string().max(max, { message: `${label} must be ${max} characters or fewer.` }));
}

// Accepts null and "" so a cleared form field and an omitted one behave the same.
function optionalText(max: number, label: string) {
  return z
    .union([textField(max, label), z.null()])
    .transform((value) => (value === null || value === "" ? null : value))
    .optional()
    .default(null);
}

type WebsiteResult = { ok: true; value: string } | { ok: false; message: string };

export function normalizeWebsite(raw: string): WebsiteResult {
  if (raw.length > BUSINESS_PROFILE_LIMITS.website) {
    return {
      ok: false,
      message: `Website must be ${BUSINESS_PROFILE_LIMITS.website} characters or fewer.`,
    };
  }

  // A bare domain gets https; anything with an explicit scheme keeps it so
  // `javascript:` and friends fail the allowlist instead of being prefixed.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, message: "Enter a valid website address." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: "Website must use http or https." };
  }
  if (url.username || url.password) {
    return { ok: false, message: "Website must not include credentials." };
  }
  if (!url.hostname || !url.hostname.includes(".")) {
    return { ok: false, message: "Enter a valid website address." };
  }

  // `URL` already lowercases the host; only the fragment needs removing.
  url.hash = "";
  return { ok: true, value: url.toString() };
}

const websiteField = z
  .union([z.string({ message: "Website must be text." }), z.null()])
  .transform((value, ctx) => {
    if (value === null) return null;
    const trimmed = normalizeText(value);
    if (trimmed === "") return null;

    const result = normalizeWebsite(trimmed);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.message });
      return z.NEVER;
    }
    return result.value;
  })
  .optional()
  .default(null);

const detailsSchema = z
  .strictObject({
    targetCustomers: optionalText(
      BUSINESS_PROFILE_LIMITS.targetCustomers,
      "Target customers",
    ),
    geographies: optionalText(BUSINESS_PROFILE_LIMITS.geographies, "Geographic markets"),
    differentiators: optionalText(
      BUSINESS_PROFILE_LIMITS.differentiators,
      "Differentiators",
    ),
    goals: optionalText(BUSINESS_PROFILE_LIMITS.goals, "Acquisition goals"),
  })
  .transform(
    (value): BusinessProfileDetails => ({
      targetCustomers: value.targetCustomers,
      geographies: value.geographies,
      differentiators: value.differentiators,
      goals: value.goals,
    }),
  );

// The token is produced by to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') in the
// repository. Microseconds are significant: a JS Date would truncate them and
// turn every optimistic update into a false conflict.
const UPDATED_AT_TOKEN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

const inputSchema = z
  .strictObject({
    name: textField(BUSINESS_PROFILE_LIMITS.name, "Business name").pipe(
      z.string().min(1, { message: "Business name is required." }),
    ),
    website: websiteField,
    industry: optionalText(BUSINESS_PROFILE_LIMITS.industry, "Industry"),
    description: optionalText(BUSINESS_PROFILE_LIMITS.description, "Description"),
    details: detailsSchema.optional(),
    complete: z.boolean({ message: "Complete must be true or false." }).optional().default(false),
    expectedUpdatedAt: z
      .union([
        z.null(),
        z.string().regex(UPDATED_AT_TOKEN, {
          message: "expectedUpdatedAt is not a valid update token.",
        }),
      ])
      .optional()
      .default(null),
  })
  .superRefine((value, ctx) => {
    // Drafts need only a name; completion also needs a description.
    if (value.complete && !value.description) {
      ctx.addIssue({
        code: "custom",
        path: ["description"],
        message: "Description is required to complete onboarding.",
      });
    }
  });

function toFieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "body";
    // First message per field: later issues are usually consequences of the first.
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

export function parseBusinessProfileInput(input: unknown): BusinessProfileValidation {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fields: toFieldErrors(parsed.error) };

  return {
    ok: true,
    data: {
      ...parsed.data,
      details: parsed.data.details ?? EMPTY_DETAILS,
    },
  };
}
