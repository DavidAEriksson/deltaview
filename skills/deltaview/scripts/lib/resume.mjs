import fs from "node:fs";
import path from "node:path";

export const slug = (ref) => ref.replace(/[^A-Za-z0-9._-]+/g, "-");

export function findResumable(reviewsDir, ref, headSha) {
  if (!fs.existsSync(reviewsDir)) return null;
  const prefix = `${slug(ref)}-`;
  const files = fs.readdirSync(reviewsDir).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort().reverse();
  for (const f of files) {
    const p = path.join(reviewsDir, f);
    try {
      const m = JSON.parse(fs.readFileSync(p, "utf8"));
      if (m.status === "in_progress" && m.headSha === headSha && m.items?.length) return p; // no items = analysis never finished
    } catch { /* skip unreadable manifest */ }
  }
  return null;
}
