"use client";

import { toast } from "sonner";

/** Clipboard helper with execCommand fallback (shared across pages). */
export async function copyText(text: string, label = "Copied to clipboard") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast.success(label);
    } catch {
      toast.error("Clipboard unavailable");
    }
  }
}
