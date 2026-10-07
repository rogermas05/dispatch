import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base so the built page can be dropped on any static host or subpath.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
