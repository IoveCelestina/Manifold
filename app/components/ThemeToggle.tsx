"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    const next = window.localStorage.getItem("blog-theme") === "light";
    document.documentElement.dataset.theme = next ? "light" : "dark";
    setLight(next);
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    document.documentElement.dataset.theme = next ? "light" : "dark";
    window.localStorage.setItem("blog-theme", next ? "light" : "dark");
  }

  return <button className="theme-toggle" onClick={toggle} aria-label={light ? "切换到深色主题" : "切换到浅色主题"}>{light ? "☾" : "☼"}</button>;
}
