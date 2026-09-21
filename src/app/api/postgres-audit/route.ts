// ─── /api/postgres-audit — Postgres-readiness per fleet app ─────────────────
// GET  → admin-gated (2026-09-21: was public — leaked repo-structure/infra
//        recon to anyone; the dashboard consumes it post-login anyway).
// POST → admin-gated:
//   { action: "rescan" }                  → live GitHub re-scan, refresh baseline
//   { action: "step", repo, index, done } → toggle a migration-plan step
//   { action: "resetApp", repo }          → clear one app's progress
//   { action: "resetAll" }                → clear all progress

import { NextResponse } from "next/server";

import { GITHUB_OWNER } from "@/lib/fleet";
import {
  emptySteps,
  readPgBaseline,
  readPgStatus,
  rescanFleet,
  summarize,
  writePgBaseline,
  writePgStatus,
  type PgBaseline,
  type PgStatusMap,
} from "@/lib/pg-audit";
import { requireAdmin } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = requireAdmin(req);
  if (gate) return gate;

  const baseline = await readPgBaseline();
  const status = await readPgStatus();
  const apps = baseline?.apps ?? [];
  return NextResponse.json(
    {
      baseline: baseline
        ? { scannedAt: baseline.scannedAt, source: baseline.source, owner: baseline.owner }
        : null,
      apps,
      status,
      summary: summarize(apps, status),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

interface StepBody {
  action?: string;
  repo?: string;
  index?: number;
  done?: boolean;
}

export async function POST(req: Request) {
  const gate = requireAdmin(req);
  if (gate) return gate;

  let body: StepBody;
  try {
    body = (await req.json()) as StepBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action === "rescan") {
    try {
      const owner = (await readPgBaseline())?.owner ?? GITHUB_OWNER;
      const { apps, scannedAt } = await rescanFleet(owner);
      const baseline: PgBaseline = {
        scannedAt,
        source: "live re-scan from the dashboard (GitHub trees + package.json + prisma schemas)",
        owner,
        apps,
      };
      const persisted = await writePgBaseline(baseline);
      const status = await readPgStatus();
      return NextResponse.json({
        ok: true,
        persisted,
        apps,
        scannedAt,
        summary: summarize(apps, status),
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Re-scan failed" },
        { status: 502 },
      );
    }
  }

  if (body.action === "step") {
    const repo = String(body.repo ?? "");
    const index = Number(body.index);
    if (!repo || !Number.isInteger(index) || index < 0 || index > 5) {
      return NextResponse.json({ error: "Invalid repo or step index" }, { status: 400 });
    }
    const status = await readPgStatus();
    const entry = status.apps[repo] ?? { steps: emptySteps(), updatedAt: "" };
    const steps = entry.steps.length === 6 ? [...entry.steps] : emptySteps();
    steps[index] = Boolean(body.done);
    const next: PgStatusMap = {
      apps: {
        ...status.apps,
        [repo]: { steps, updatedAt: new Date().toISOString() },
      },
    };
    await writePgStatus(next);
    return NextResponse.json({ ok: true, status: next });
  }

  if (body.action === "resetApp") {
    const repo = String(body.repo ?? "");
    if (!repo) return NextResponse.json({ error: "Missing repo" }, { status: 400 });
    const status = await readPgStatus();
    const { [repo]: _drop, ...rest } = status.apps;
    const next: PgStatusMap = { apps: rest };
    await writePgStatus(next);
    return NextResponse.json({ ok: true, status: next });
  }

  if (body.action === "resetAll") {
    const next: PgStatusMap = { apps: {} };
    await writePgStatus(next);
    return NextResponse.json({ ok: true, status: next });
  }

  return NextResponse.json(
    { error: 'Unknown action — expected "rescan", "step", "resetApp" or "resetAll".' },
    { status: 400 },
  );
}
