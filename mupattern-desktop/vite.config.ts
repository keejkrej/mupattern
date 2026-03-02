import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  base: "./",
  plugins: [preact(), tailwindcss()],
  resolve: {
    alias: {
      react: "preact/compat",
      "react-dom": "preact/compat",
      "react-dom/client": "preact/compat/client",
      "react-dom/test-utils": "preact/test-utils",
      "react/jsx-runtime": "preact/jsx-runtime",
      "react/jsx-dev-runtime": "preact/jsx-dev-runtime",
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
