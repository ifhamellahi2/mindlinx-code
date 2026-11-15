import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessProfiles } from "@/db/schema";
import type { BusinessProfileDetails, BusinessProfileInput } from "./validation";

export type BusinessProfileDto = {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  description: string | null;
  details: BusinessProfileDetails;
  completedAt: string | null;
  createdAt: string;
  /** Optimistic token. Echo this back as `expectedUpdatedAt` to update. */
  updatedAt: string;
};

export type SaveBusinessProfileResult =
  | { status: "saved"; profile: BusinessProfileDto }
  | { status: "conflict" };

// Microseconds are preserved deliberately: the value is returned to the client
// and compared verbatim, so a JS Date round-trip must never be involved.
const profileSelection = {
  id: businessProfiles.id,
  name: businessProfiles.name,
  website: businessProfiles.website,
  industry: businessProfiles.industry,
  description: businessProfiles.description,
  details: businessProfiles.details,
  completedAt: sql<string | null>`case when ${businessProfiles.completedAt} is null then null else to_char(${businessProfiles.completedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end`,
  createdAt: sql<string>`to_char(${businessProfiles.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  updatedAt: sql<string>`to_char(${businessProfiles.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
};

type ProfileRow = {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  description: string | null;
  details: unknown;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function asDetails(value: unknown): BusinessProfileDetails {
  const raw = (value ?? {}) as Record<string, unknown>;
  const read = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : null);

  return {
    targetCustomers: read("targetCustomers"),
    geographies: read("geographies"),
    differentiators: read("differentiators"),
    goals: read("goals"),
  };
}

function toDto(row: ProfileRow): BusinessProfileDto {
  return {
    id: row.id,
    name: row.name,
    website: row.website,
    industry: row.industry,
    description: row.description,
    details: asDetails(row.details),
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The workspace's live profile, or null. Soft-deleted rows are invisible. */
export async function getBusinessProfile(
  workspaceId: string,
): Promise<BusinessProfileDto | null> {
  const [row] = await db
    .select(profileSelection)
    .from(businessProfiles)
    .where(
      and(
        eq(businessProfiles.workspaceId, workspaceId),
        isNull(businessProfiles.deletedAt),
      ),
    )
    .limit(1);

  return row ? toDto(row) : null;
}

function sameContent(profile: BusinessProfileDto, input: BusinessProfileInput) {
  return (
    profile.name === input.name &&
    profile.website === input.website &&
    profile.industry === input.industry &&
    profile.description === input.description &&
    profile.details.targetCustomers === input.details.targetCustomers &&
    profile.details.geographies === input.details.geographies &&
    profile.details.differentiators === input.details.differentiators &&
    profile.details.goals === input.details.goals &&
    (profile.completedAt !== null) === input.complete
  );
}

/**
 * Creates or updates the one live profile for a workspace.
 *
 * - No token: INSERT relying on `business_profiles_workspace_live_unique`, so
 *   concurrent first saves cannot produce two rows.
 * - Token: UPDATE guarded by `updated_at`, so a stale writer gets a conflict
 *   instead of overwriting someone else's edit.
 * - A stale token whose payload already matches what is stored is a retried
 *   request, not a conflict: return the stored profile untouched.
 */
export async function saveBusinessProfile(
  workspaceId: string,
  input: BusinessProfileInput,
): Promise<SaveBusinessProfileResult> {
  const values = {
    name: input.name,
    website: input.website,
    industry: input.industry,
    description: input.description,
    details: input.details,
  };

  if (input.expectedUpdatedAt === null) {
    const [created] = await db
      .insert(businessProfiles)
      .values({
        workspaceId,
        ...values,
        completedAt: input.complete ? sql`now()` : null,
      })
      .onConflictDoNothing({
        target: businessProfiles.workspaceId,
        where: sql`${businessProfiles.deletedAt} is null`,
      })
      .returning(profileSelection);

    if (created) return { status: "saved", profile: toDto(created) };

    // Another request created the live profile first. Identical data is a
    // double submit; anything else is a genuine conflict.
    const current = await getBusinessProfile(workspaceId);
    if (!current) return { status: "conflict" };
    return sameContent(current, input)
      ? { status: "saved", profile: current }
      : { status: "conflict" };
  }

  const [updated] = await db
    .update(businessProfiles)
    .set({
      ...values,
      // Completing keeps the original timestamp; saving as a draft clears it.
      completedAt: input.complete
        ? sql`coalesce(${businessProfiles.completedAt}, now())`
        : null,
    })
    .where(
      and(
        eq(businessProfiles.workspaceId, workspaceId),
        isNull(businessProfiles.deletedAt),
        sql`${businessProfiles.updatedAt} = ${input.expectedUpdatedAt}::timestamptz`,
        // An unchanged save must not bump updated_at (the trigger fires even
        // when the new values equal the old ones).
        sql`(${businessProfiles.name}, ${businessProfiles.website}, ${businessProfiles.industry}, ${businessProfiles.description}, ${businessProfiles.details}, ${businessProfiles.completedAt} is not null) is distinct from (${input.name}, ${input.website}, ${input.industry}, ${input.description}, ${JSON.stringify(
          input.details,
        )}::jsonb, ${input.complete})`,
      ),
    )
    .returning(profileSelection);

  if (updated) return { status: "saved", profile: toDto(updated) };

  const current = await getBusinessProfile(workspaceId);
  if (!current) return { status: "conflict" };
  return sameContent(current, input)
    ? { status: "saved", profile: current }
    : { status: "conflict" };
}
