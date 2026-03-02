import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
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
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("/node_modules/")) return;

          const i = id.lastIndexOf("/node_modules/");
          const rest = id.slice(i + "/node_modules/".length);
          const pkg = rest.startsWith("@")
            ? rest.slice(0, rest.indexOf("/", rest.indexOf("/") + 1))
            : rest.split("/")[0];
          const packageFile = rest.split("/").at(-1) ?? "";
          const packageBasename = packageFile.replace(/\.js$/, "");

          if (pkg === "zarrita" || pkg === "@zarrita/storage") {
            return "zarr-vendors";
          }
          if (pkg === "numcodecs") {
            if (packageBasename !== "index") {
              return `numcodecs-${packageBasename}`;
            }
            return "numcodecs-core";
          }

          if (pkg?.includes("react") || pkg?.includes("preact")) {
            return "ui-vendors";
          }
          if (pkg === "lucide-react") {
            return "ui-icons";
          }
        },
      },
    },
  },
});
