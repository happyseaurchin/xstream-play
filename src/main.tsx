/**
 * main.tsx — xstream-play entry point.
 *
 * Sovereign browser kernel. No server runs LLM calls.
 * Each player's browser is the engine.
 */

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
