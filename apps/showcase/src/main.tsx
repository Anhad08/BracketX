import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
// Side-effect import: every scene module registers itself. This is the ONLY
// place the scene set is assembled, and adding a showcase means adding a line
// to scenes/index.ts — never touching the shell.
import "./scenes";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
