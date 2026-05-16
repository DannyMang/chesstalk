const STORAGE_KEY = "chesstalk.guestId";

function randomGuestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getOrCreateGuestId(): string {
  if (typeof window === "undefined") return randomGuestId();
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const id = randomGuestId();
  window.localStorage.setItem(STORAGE_KEY, id);
  return id;
}
