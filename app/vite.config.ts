import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // The report's payment decoding uses Buffer only in Node; the app never calls it.
  // Meteor's wallet module also expects Node's `global`.
  define: { "process.env": {}, global: "globalThis" },
  server: { port: 5173 },
});
