import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { deletedAtColumn, timestamps } from "./_shared";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name").notNull(),
    image: text("image"),
    ...timestamps(),
  },
  (table) => [
    unique("users_email_unique").on(table.email),
    // Better Auth lowercases emails, but the engine should not have to trust
    // that: this is the constraint that actually prevents case duplicates.
    uniqueIndex("users_email_lower_unique").on(sql`lower(${table.email})`),
  ],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // Marks the one workspace created for a user's first registration. Ordinary
    // workspaces leave this NULL; the partial unique index makes "one initial
    // workspace per user" a database invariant instead of a code convention.
    initialForUserId: uuid("initial_for_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
    deletedAt: deletedAtColumn(),
  },
  (table) => [
    unique("workspaces_slug_unique").on(table.slug),
    uniqueIndex("workspaces_initial_for_user_unique")
      .on(table.initialForUserId)
      .where(sql`${table.initialForUserId} is not null`),
    check(
      "workspaces_slug_lowercase_check",
      sql`char_length(${table.slug}) > 0 and ${table.slug} = lower(${table.slug})`,
    ),
  ],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    ...timestamps(),
  },
  (table) => [
    unique("workspace_members_workspace_user_unique").on(
      table.workspaceId,
      table.userId,
    ),
    // At most one owner per workspace. The server enforces at least one.
    uniqueIndex("workspace_members_one_owner_unique")
      .on(table.workspaceId)
      .where(sql`${table.role} = 'owner'`),
    index("workspace_members_user_id_idx").on(table.userId),
    check(
      "workspace_members_role_check",
      sql`${table.role} in ('owner', 'admin', 'member')`,
    ),
  ],
);
