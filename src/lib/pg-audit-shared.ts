// ─── Postgres-readiness — SHARED (client-safe, no node imports) ─────────────
// Verdicts, the 6-step migration plan, copy-ready snippets and the classifier.
// The server-only IO + GitHub scanning lives in pg-audit.ts.

export type PgVerdict = "needs" | "optional" | "ok";
export type PgPriority = "critical" | "high" | "medium" | "low";

export interface PgRepoScan {
  repo: string;
  branch: string;
  language: string | null;
  framework: string | null;
  apiRoutes: number;
  hasPrisma: boolean;
  prismaProvider: string | null;
  hasSqliteFile: boolean;
  jsonStateFiles: number;
  jsonStateDir: string | null;
  deps: string[];
  pushedAt: string | null;
}

export interface PgAppAudit extends PgRepoScan {
  verdict: PgVerdict;
  priority: PgPriority;
  reasons: string[];
  fixSummary: string;
  hosts: string[];
  vercelProject: string | null;
  inFleet: boolean;
}

export interface PgBaseline {
  scannedAt: string;
  source: string;
  owner: string;
  apps: PgAppAudit[];
}

export interface PgAppStatus {
  steps: boolean[]; // mirrors MIGRATION_STEPS length
  updatedAt: string;
}

export interface PgStatusMap {
  apps: Record<string, PgAppStatus>;
}

// ─── The 6-step migration plan (identical structure for every app) ──────────

export interface MigrationStep {
  title: string;
  detail: string;
}

export const MIGRATION_STEPS: MigrationStep[] = [
  {
    title: "Create a Neon database",
    detail:
      "Free tier at neon.tech (Vercel Postgres is Neon underneath) — copy the pooled connection string.",
  },
  {
    title: "Add DATABASE_URL to Vercel",
    detail:
      "Project → Settings → Environment Variables (add it locally to .env too for development).",
  },
  {
    title: "Switch Prisma provider",
    detail: 'In prisma/schema.prisma change provider "sqlite" → "postgresql".',
  },
  {
    title: "Push the schema",
    detail: "npx prisma db push — creates the tables on Neon from the existing models.",
  },
  {
    title: "Port existing data",
    detail:
      "One-time ETL from the SQLite file / JSON state into Postgres (skip if there is nothing worth keeping).",
  },
  {
    title: "Redeploy & verify",
    detail:
      "Trigger a production deploy, submit data once, wait for a cold start — confirm it survived.",
  },
];

export const STEP_COUNT = MIGRATION_STEPS.length;

/** Copy-ready command/config snippet for step `i` of `repo`'s migration space. */
export function stepSnippet(i: number, repo: string): string {
  switch (i) {
    case 0:
      return [
        "# neon.tech → New project → copy the POOLED string",
        "postgres://<user>:<pass>@ep-<id>.neon.tech/neondb?sslmode=require",
      ].join("\n");
    case 1:
      return [
        `# Vercel dashboard → ${repo} → Settings → Environment Variables`,
        "# or from the repo root:",
        "vercel env add DATABASE_URL",
        'DATABASE_URL="postgres://…neon.tech/neondb?sslmode=require"',
      ].join("\n");
    case 2:
      return [
        `// ${repo}/prisma/schema.prisma`,
        "datasource db {",
        '  provider = "postgresql"',
        '  url      = env("DATABASE_URL")',
        "}",
      ].join("\n");
    case 3:
      return [
        `cd ${repo}`,
        "npx prisma generate",
        "npx prisma db push        # creates the tables on Neon",
      ].join("\n");
    case 4:
      return [
        "# one-time ETL — export from SQLite/JSON, import into Postgres",
        `# ${repo}: seed or port script, e.g.`,
        "npx prisma db seed        # or node scripts/port-to-postgres.ts",
      ].join("\n");
    case 5:
      return [
        "vercel --prod             # or Redeploy from the Vercel dashboard",
        "# verify: write once → wait for a cold start → data still there",
      ].join("\n");
    default:
      return "";
  }
}

// ─── Verdict engine ──────────────────────────────────────────────────────────

export function classifyApp(s: PgRepoScan): {
  verdict: PgVerdict;
  priority: PgPriority;
  reasons: string[];
  fixSummary: string;
} {
  const reasons: string[] = [];
  if (s.hasPrisma) {
    reasons.push(
      s.prismaProvider === "sqlite"
        ? "Prisma schema → SQLite provider"
        : `Prisma schema → ${s.prismaProvider ?? "unknown"} provider`,
    );
  }
  if (s.hasSqliteFile) {
    reasons.push("SQLite file committed (build-time snapshot — not runtime-writable)");
  }
  if (s.apiRoutes > 0) reasons.push(`${s.apiRoutes} serverless API routes`);
  if (s.jsonStateFiles > 0) {
    reasons.push(
      `${s.jsonStateFiles} JSON state files under ${s.jsonStateDir ?? "state dir"} (ephemeral at runtime)`,
    );
  }

  const sqliteBound = (s.hasPrisma && s.prismaProvider === "sqlite") || s.hasSqliteFile;

  if (sqliteBound) {
    const priority: PgPriority = s.apiRoutes > 0 ? "high" : "medium";
    return {
      verdict: "needs",
      priority,
      reasons,
      fixSummary:
        s.apiRoutes > 0
          ? "Port the Prisma datasource to PostgreSQL (and any runtime JSON state to tables) so data survives serverless cold starts."
          : "SQLite is only readable from the build snapshot — if any server component queries it at runtime, port it to Postgres.",
    };
  }

  if (s.apiRoutes > 0) {
    return {
      verdict: "optional",
      priority: "low",
      reasons,
      fixSummary:
        "Stateless serverless routes — fine without a DB. Migrate only if the app starts persisting data.",
    };
  }

  return {
    verdict: "ok",
    priority: "low",
    reasons,
    fixSummary: "Nothing to migrate — no backend state on the server.",
  };
}

// ─── Summary counts for KPI cards ────────────────────────────────────────────

export interface PgSummary {
  total: number;
  needs: number;
  optional: number;
  ok: number;
  fleetRepos: number;
  sqliteSchemas: number;
  stepsDone: number;
  stepsTotal: number;
}

export function summarize(apps: PgAppAudit[], status: PgStatusMap): PgSummary {
  const stepsTotal = apps.filter((a) => a.verdict === "needs").length * STEP_COUNT;
  let stepsDone = 0;
  for (const a of apps) {
    if (a.verdict !== "needs") continue;
    const st = status.apps[a.repo];
    if (st?.steps) stepsDone += st.steps.filter(Boolean).length;
  }
  return {
    total: apps.length,
    needs: apps.filter((a) => a.verdict === "needs").length,
    optional: apps.filter((a) => a.verdict === "optional").length,
    ok: apps.filter((a) => a.verdict === "ok").length,
    fleetRepos: apps.filter((a) => a.inFleet).length,
    sqliteSchemas: apps.filter((a) => a.hasPrisma && a.prismaProvider === "sqlite").length,
    stepsDone,
    stepsTotal,
  };
}

export const PRIORITY_LABEL: Record<PgPriority, string> = {
  critical: "critical",
  high: "high priority",
  medium: "medium priority",
  low: "low priority",
};

export const VERDICT_LABEL: Record<PgVerdict, string> = {
  needs: "Needs migration",
  optional: "Optional",
  ok: "Ready as-is",
};
