import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { AppBoundary } from "./ui/boundary";
import "./styles.css";
import "./shell.css";

const root = document.getElementById("root");
if (root === null) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    {/* Above the shell, not inside it: the shell itself can throw, and a
        boundary beneath it would be unmounted along with everything else. */}
    <AppBoundary>
      <App />
    </AppBoundary>
  </StrictMode>,
);
