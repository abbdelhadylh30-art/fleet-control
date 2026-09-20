"use client";

// ─── Client companion to the one-time challenge system ───────────────────────
// Backend: src/lib/security.ts (issueChallenge / consumeChallenge).
//
// Destructive dashboard actions run in TWO STEPS:
//   1st click → POST /api/auth {action:"challenge", op} — the server issues a
//               single-use token (valid 120s) and the button arms itself,
//               showing a countdown.
//   2nd click → the actual request is sent WITH the confirmToken. Without a
//               fresh token the API always answers 403, so a stray click,
//               double-fire or replayed request can never execute alone —
//               the "re-auth for destructive ops" step the review asked for.
//
// Each component instance tracks ONE armed op at a time; arming a different op
// disarms the previous one. Auto-disarms when the countdown hits zero.

import { useCallback, useEffect, useRef, useState } from "react";

interface ChallengeResponse {
  ok?: boolean;
  confirmToken?: string;
  expiresIn?: number;
  error?: string;
}

export function useChallengeAction() {
  const [armedOp, setArmedOp] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const tokenRef = useRef<{ op: string; token: string } | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const disarm = useCallback(() => {
    tokenRef.current = null;
    setArmedOp(null);
    setSecondsLeft(0);
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  // clear the interval on unmount
  useEffect(
    () => () => {
      if (tickRef.current) clearInterval(tickRef.current);
    },
    [],
  );

  const arm = useCallback(
    async (op: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "challenge", op }),
        });
        const json = (await res.json()) as ChallengeResponse;
        if (!res.ok || !json.ok || !json.confirmToken) {
          return { ok: false, error: json.error ?? "could not start the confirmation" };
        }
        tokenRef.current = { op, token: json.confirmToken };
        setArmedOp(op);
        let left = Math.max(1, Math.round(json.expiresIn ?? 120));
        setSecondsLeft(left);
        if (tickRef.current) clearInterval(tickRef.current);
        tickRef.current = setInterval(() => {
          left -= 1;
          if (left <= 0) disarm();
          else setSecondsLeft(left);
        }, 1000);
        return { ok: true };
      } catch {
        return { ok: false, error: "network error while requesting confirmation" };
      }
    },
    [disarm],
  );

  /** Two-step trigger: first call arms the button, second call executes. */
  const trigger = useCallback(
    async (op: string, execute: (confirmToken: string) => Promise<void>): Promise<void> => {
      const held = tokenRef.current;
      if (armedOp !== op || !held || held.op !== op) {
        const r = await arm(op);
        if (!r.ok) {
          const { toast } = await import("sonner");
          toast.error(r.error ?? "Could not start confirmation");
        }
        return;
      }
      const token = held.token;
      disarm();
      await execute(token);
    },
    [armedOp, arm, disarm],
  );

  return { armedOp, secondsLeft, trigger, disarm };
}
