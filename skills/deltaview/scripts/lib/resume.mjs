import fs from "node:fs";
import path from "node:path";

export const slug = (ref) => ref.replace(/[^A-Za-z0-9._-]+/g, "-");

// newest manifest of `ref` (with items: no items = analysis never finished) that passes `pick`
function newest(reviewsDir, ref, pick) {
  if (!fs.existsSync(reviewsDir)) return null;
  const prefix = `${slug(ref)}-`;
  const files = fs.readdirSync(reviewsDir).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort().reverse();
  for (const f of files) {
    const p = path.join(reviewsDir, f);
    try {
      const m = JSON.parse(fs.readFileSync(p, "utf8"));
      if (m.ref === ref && m.items?.length && pick(m)) return p;
    } catch { /* skip unreadable manifest */ }
  }
  return null;
}

export const findResumable = (reviewsDir, ref, headSha) => newest(reviewsDir, ref, (m) => m.status === "in_progress" && m.headSha === headSha);

// the review to carry decisions from: the newest one of this ref at another commit, finished or not
export const findPrevious = (reviewsDir, ref, headSha) => newest(reviewsDir, ref, (m) => m.headSha !== headSha);
