export const workspaceNamespace = "godspeed-workspace";
export const legacyWorkspaceNamespace = "atlas-workspace";
export const chatConsentKey = "godspeed-chat-ai-consent";

export const preferenceKeys = {
  theme: ["godspeed-theme", "atlas-theme"],
  aiEnabled: ["godspeed-ai-enabled", "atlas-ai-enabled"],
} as const;

export function migratePreferences() {
  try {
    for (const [key, previousKey] of Object.values(preferenceKeys)) {
      if (localStorage.getItem(key) !== null) continue;
      const inherited = localStorage.getItem(previousKey);
      if (inherited !== null) localStorage.setItem(key, inherited);
    }
  } catch { /* The existing preferences are still usable if writes are blocked. */ }
}

export function clearSessionDrafts() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && (key.startsWith("godspeed-draft:") || key.startsWith("atlas-draft:"))) sessionStorage.removeItem(key);
    }
  } catch { /* The replaced workspace ID already invalidates previous drafts. */ }
}
