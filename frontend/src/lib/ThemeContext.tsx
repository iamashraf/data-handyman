import { createContext, useContext } from "react";
import type { ThemeMode } from "./theme";

export const ThemeContext = createContext<ThemeMode>("light");

export function useTheme(): ThemeMode {
  return useContext(ThemeContext);
}
