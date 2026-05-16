import { Profanease, normalize } from "profanease";
import en from "profanease/langs/en";

const filter = new Profanease({
  languages: [en],
  normalize: "aggressive",
});

export function isAllowedDisplayName(username: string): boolean {
  const normalized = normalize(username, "aggressive").replace(/[^a-z0-9]+/gi, " ");
  const compact = normalized.replace(/\s+/g, "");
  if (compact.length === 0) return false;

  return !filter.check(normalized) && !filter.check(compact);
}
