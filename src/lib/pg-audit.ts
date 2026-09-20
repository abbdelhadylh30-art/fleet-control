// ─── Postgres-readiness audit engine — SERVER-ONLY (GitHub access + state) ──
// Re-exports the client-safe core from pg-audit-shared.ts and adds:
//   • baseline/status IO (Postgres-backed via pg-state, file fallback)
//   • per-repo GitHub scanning + live fleet re-scan via the vault token
// The initial baseline is committed (db/postgres-audit.json); an admin-gated
// re-scan refreshes it live from the GitHub API.

import {
  classifyApp,
  STEP_COUNT,
  type PgAppAudit,
  type PgBaseline,
  type PgPriority,
  type PgRepoScan,
  type PgStatusMap,
  type PgVerdict,
} from "./pg-audit-shared";
import { readState, writeState } from "./pg-state";

export * from "./pg-audit-shared";

// ─── Baseline + status IO ────────────────────────────────────────────────────

export async function readPgBaseline(): Promise<PgBaseline | null> {
  return readState<PgBaseline>("postgres-audit");
}

export async function writePgBaseline(b: PgBaseline): Promise<boolean> {
  // durable in Postgres once fleet-control's own migration is live;
  // otherwise falls back to the (committed) db/postgres-audit.json file
  return writeState("postgres-audit", b);
}

export async function readPgStatus(): Promise<PgStatusMap> {
  return (await readState<PgStatusMap>("pg-migration-status")) ?? { apps: {} };
}

export async function writePgStatus(s: PgStatusMap): Promise<boolean> {
  return writeState("pg-migration-status", s);
}

export function emptySteps(): boolean[] {
  return Array.from({ length: STEP_COUNT }, () => false);
}

// ─── GitHub scanning + live re-scan ─────────────────────────────────────────

const GH_API = "https://api.github.com";

const WATCHED_DEPS = [
  "prisma",
  "@prisma/client",
  "better-sqlite3",
  "sqlite3",
  "lowdb",
  "@neondatabase/serverless",
  "pg",
  "postgres",
  "mysql2",
  "mongoose",
  "redis",
  "ioredis",
  "next",
  "vite",
  "react",
];

async function ghJson(pathname: string, token: string): Promise<unknown> {
  const res = await fetch(`${GH_API}${pathname}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "fleet-control-pg-audit",
    },
    signal: AbortSignal.timeout(30000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${pathname.split("?")[0]}`);
  return res.json();
}

/**
 * Fetch a raw file via the Git contents API — works for PRIVATE repos too
 * (raw.githubusercontent.com 404s there without auth).
 */
async function ghFileText(
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  token: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${GH_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branch)}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github.raw",
          "user-agent": "fleet-control-pg-audit",
        },
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

interface GhRepoMeta {
  name: string;
  default_branch: string;
  language: string | null;
  pushed_at: string | null;
}

/** Scan one repo: tree (recursive) + package.json + prisma provider. */
export async function scanRepo(owner: string, token: string, repo: string): Promise<PgRepoScan> {
  const meta = (await ghJson(`/repos/${owner}/${repo}`, token)) as GhRepoMeta;
  const branch = meta.default_branch || "main";

  const scan: PgRepoScan = {
    repo,
    branch,
    language: meta.language ?? null,
    framework: null,
    apiRoutes: 0,
    hasPrisma: false,
    prismaProvider: null,
    hasSqliteFile: false,
    jsonStateFiles: 0,
    jsonStateDir: null,
    deps: [],
    pushedAt: meta.pushed_at ?? null,
  };

  try {
    const tree = (await ghJson(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, token)) as {
      tree?: { path: string }[];
      truncated?: boolean;
    };
    const paths = (tree.tree ?? []).map((t) => t.path);

    scan.apiRoutes = paths.filter(
      (p) =>
        (p.startsWith("src/app/api/") || p.startsWith("app/api/")) && p.endsWith("/route.ts"),
    ).length;
    scan.hasPrisma = paths.some((p) => p === "prisma/schema.prisma");
    scan.hasSqliteFile = paths.some(
      (p) => !p.includes("node_modules") && /\.(db|sqlite|sqlite3)$/.test(p),
    );
    for (const dir of ["db/", "data/", ".data/", "store/"]) {
      const hits = paths.filter((p) => p.startsWith(dir) && p.endsWith(".json"));
      if (hits.length > scan.jsonStateFiles) {
        scan.jsonStateFiles = hits.length;
        scan.jsonStateDir = dir;
      }
    }
  } catch {
    /* tree unavailable — package.json still informs the verdict */
  }

  try {
    const pkgRaw = await ghFileText(owner, repo, branch, "package.json", token);
    if (pkgRaw) {
      const pkg = JSON.parse(pkgRaw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      scan.deps = WATCHED_DEPS.filter((d) => deps[d]);
      scan.framework = deps.next
        ? `next@${deps.next}`
        : deps.vite
          ? "vite"
          : deps.react
            ? "react"
            : null;
    }
  } catch {
    /* no package.json — static / non-Node repo */
  }

  if (scan.hasPrisma) {
    const schemaRaw = await ghFileText(owner, repo, branch, "prisma/schema.prisma", token);
    if (schemaRaw) {
      const m = schemaRaw.match(/provider\s*=\s*"(\w+)"/);
      scan.prismaProvider = m ? m[1] : null;
    }
  }

  return scan;
}

/**
 * Live fleet re-scan. Scans the union of the account's public repos and the
 * repos already in the baseline (private repos never appear in the public
 * listing). Hosts/vercelProject/inFleet join from the existing baseline.
 */
export async function rescanFleet(owner: string): Promise<{
  apps: PgAppAudit[];
  scannedAt: string;
}> {
  const { readGithubAuth } = await import("./agent-vault");
  const store = await readGithubAuth();
  if (!store) throw new Error("GitHub not connected in the vault — cannot re-scan");

  const prev = await readPgBaseline();
  const prevByRepo = new Map((prev?.apps ?? []).map((a) => [a.repo, a]));

  const repos = new Set<string>((prev?.apps ?? []).map((a) => a.repo));
  try {
    const list = (await ghJson(`/users/${owner}/repos?per_page=100&sort=pushed`, store.token)) as
      GhRepoMeta[];
    for (const r of list) repos.add(r.name);
  } catch {
    /* listing failed — scan baseline repos only */
  }

  const apps: PgAppAudit[] = [];
  for (const repo of repos) {
    try {
      const scan = await scanRepo(owner, store.token, repo);
      const cls = classifyApp(scan);
      const meta = prevByRepo.get(repo);
      apps.push({
        ...scan,
        ...cls,
        hosts: meta?.hosts ?? [],
        vercelProject: meta?.vercelProject ?? null,
        inFleet: meta ? meta.inFleet : false,
      });
    } catch {
      // keep the previous baseline entry so the UI never loses an app
      const meta = prevByRepo.get(repo);
      if (meta) apps.push(meta);
    }
  }

  apps.sort((a, b) => {
    const order: Record<PgVerdict, number> = { needs: 0, optional: 1, ok: 2 };
    const prio: Record<PgPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    if (order[a.verdict] !== order[b.verdict]) return order[a.verdict] - order[b.verdict];
    if (prio[a.priority] !== prio[b.priority]) return prio[a.priority] - prio[b.priority];
    return a.repo.localeCompare(b.repo);
  });

  return { apps, scannedAt: new Date().toISOString() };
}
