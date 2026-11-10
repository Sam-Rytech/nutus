import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // The report's payment decoding uses Buffer only in Node; the app never calls it.
  define: { "process.env": {} },
  server: { port: 5173 },
});
