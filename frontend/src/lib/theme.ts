export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "data-handyman:theme";

export function getSystemTheme(): ThemeMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The user's explicit choice, if they've ever toggled it -- null means
 *  "follow the system preference", not "light". */
export function getStoredTheme(): ThemeMode | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function storeTheme(theme: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage can throw (private mode, quota) -- the toggle still
    // works for the rest of this session, it just won't persist.
  }
}
