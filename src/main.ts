import App from "./App.svelte";
import { applyTheme, loadPrefs } from "./lib/prefs";
import "./styles.css";
import "./motion.css";
import { mount } from "svelte";

applyTheme(loadPrefs().theme);

const app = mount(App, {
  target: document.getElementById("app") as HTMLElement
});

export default app;
