"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "diplens-theme";

/** Client-side theme switch. The dark theme is the default; "light" is opt-in
 * and persisted. An inline script in the root layout applies the class before
 * paint to avoid a flash. */
export default function ThemeToggle() {
  const [light, setLight] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLight(document.documentElement.classList.contains("light"));
    setReady(true);
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    try {
      if (next) localStorage.setItem(STORAGE_KEY, "light");
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable — toggle still works for this page load */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      title={light ? "Dark theme" : "Light theme"}
      className="rounded-md border border-line p-2 text-mute transition-colors duration-150 hover:border-info/40 hover:text-ink"
      disabled={!ready}
    >
      {light ? <Moon className="h-4 w-4" aria-hidden /> : <Sun className="h-4 w-4" aria-hidden />}
    </button>
  );
}
