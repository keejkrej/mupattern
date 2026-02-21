import { Sun, Moon } from "lucide-react";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { useTheme } from "./ThemeProvider";
import { cn } from "../lib/utils";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-2 py-1.5",
        theme === "light"
          ? "bg-white text-black border-border"
          : "bg-zinc-800/90 text-zinc-100 border-zinc-700",
      )}
    >
      <Sun className="h-4 w-4 opacity-70" />
      <Switch
        id="theme-toggle"
        checked={isDark}
        onCheckedChange={toggleTheme}
        aria-label="Toggle dark mode"
      />
      <Moon className="h-4 w-4 opacity-70" />
      <Label htmlFor="theme-toggle" className="sr-only">
        Toggle theme
      </Label>
    </div>
  );
}
