import { callable, definePlugin, toaster } from "@decky/api";
import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  Router,
  SliderField,
  TextField,
  ToggleField,
  staticClasses,
} from "@decky/ui";
import { useEffect, useState } from "react";
import { FaThLarge } from "react-icons/fa";

interface Settings {
  enabled: boolean;
  repo: string;
  branch: string;
  auto_update: boolean;
  square_capsules: boolean;
  ps5_home: boolean;
  radius: number;
  tile: number;
  last_check: number;
}
interface Theme { css: string; version: string; source: string }
interface UpdateResult { ok: boolean; changed: boolean; version: string; error?: string }

const getSettings = callable<[], Settings>("get_settings");
const setSettings = callable<[Partial<Settings>], Settings>("set_settings");
const getTheme = callable<[], Theme>("get_theme");
const updateTheme = callable<[boolean], UpdateResult>("update_theme");

const STYLE_ID = "shatteredui-css";
const VARS_ID = "shatteredui-vars";

const state: { cfg: Settings | null; theme: Theme | null } = { cfg: null, theme: null };

// Every Steam UI window (main Gaming Mode window, overlays, etc.)
function getDocs(): Document[] {
  const docs = new Set<Document>();
  const w = window as any;
  const list = w.SteamUIStore?.WindowStore?.SteamUIWindows ?? (Router as any)?.WindowStore?.SteamUIWindows ?? [];
  for (const win of list) {
    const d = win?.BrowserWindow?.document as Document | undefined;
    if (d) docs.add(d);
  }
  const main = (Router as any)?.WindowStore?.GamepadUIMainWindowInstance?.BrowserWindow?.document;
  if (main) docs.add(main);
  return [...docs];
}

function ensureStyle(doc: Document, id: string, text: string) {
  let el = doc.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement("style");
    el.id = id;
    doc.head.appendChild(el);
  }
  if (el.textContent !== text) el.textContent = text;
}

function removeFrom(doc: Document) {
  doc.getElementById(STYLE_ID)?.remove();
  doc.getElementById(VARS_ID)?.remove();
  doc.documentElement?.classList.remove("shatteredui-on", "shatteredui-square", "shatteredui-ps5");
}

function removeAll() {
  for (const doc of getDocs()) removeFrom(doc);
}

function applyAll() {
  const { cfg, theme } = state;
  if (!cfg || !theme) return;
  for (const doc of getDocs()) {
    if (!doc.head || !doc.documentElement) continue;
    if (!cfg.enabled) {
      removeFrom(doc);
      continue;
    }
    const root = doc.documentElement;
    root.classList.add("shatteredui-on");
    root.classList.toggle("shatteredui-square", cfg.square_capsules);
    root.classList.toggle("shatteredui-ps5", cfg.ps5_home);
    ensureStyle(doc, VARS_ID, `:root{--sh-radius:${cfg.radius}px;--sh-tile:${cfg.tile}px;}`);
    ensureStyle(doc, STYLE_ID, theme.css);
  }
}

async function checkForUpdates(force: boolean, quiet: boolean) {
  const r = await updateTheme(force);
  if (!r.ok) {
    if (!quiet) toaster.toast({ title: "ShatteredUI", body: `Update failed: ${r.error ?? "unknown error"}` });
    return r;
  }
  if (r.changed) {
    state.theme = await getTheme();
    applyAll();
    toaster.toast({ title: "ShatteredUI", body: `Theme updated to v${r.version}` });
  } else if (!quiet) {
    toaster.toast({ title: "ShatteredUI", body: `Already up to date (v${r.version})` });
  }
  return r;
}

function Content() {
  const [cfg, setCfg] = useState<Settings | null>(state.cfg);
  const [theme, setTheme] = useState<Theme | null>(state.theme);
  const [repo, setRepo] = useState(state.cfg?.repo ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      state.cfg = s;
      setCfg(s);
      setRepo(s.repo);
      setTheme(await getTheme());
    })();
  }, []);

  if (!cfg) return <PanelSection title="ShatteredUI">Loading…</PanelSection>;

  const patch = async (p: Partial<Settings>) => {
    const next = await setSettings(p);
    state.cfg = next;
    setCfg(next);
    applyAll();
  };

  return (
    <>
      <PanelSection title="Theme">
        <PanelSectionRow>
          <ToggleField label="Enable ShatteredUI" checked={cfg.enabled} onChange={(v) => patch({ enabled: v })} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Square capsules"
            description="Works with SteamGridDB square capsules"
            checked={cfg.square_capsules}
            onChange={(v) => patch({ square_capsules: v })}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField label="PS5-style home" checked={cfg.ps5_home} onChange={(v) => patch({ ps5_home: v })} />
        </PanelSectionRow>
        <PanelSectionRow>
          <SliderField label="Tile size" value={cfg.tile} min={120} max={300} step={10} showValue onChange={(v) => patch({ tile: v })} />
        </PanelSectionRow>
        <PanelSectionRow>
          <SliderField label="Corner radius" value={cfg.radius} min={0} max={40} step={2} showValue onChange={(v) => patch({ radius: v })} />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Updates">
        <PanelSectionRow>
          <TextField label="GitHub repo" value={repo} onChange={(e) => setRepo(e.target.value)} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField label="Auto-update on launch" checked={cfg.auto_update} onChange={(v) => patch({ auto_update: v })} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await patch({ repo });
              await checkForUpdates(true, false);
              setTheme(await getTheme());
              setBusy(false);
            }}
          >
            {busy ? "Updating…" : "Check for updates"}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Theme: {theme?.source ?? "?"} · v{theme?.version ?? "?"}
          </div>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}

export default definePlugin(() => {
  let timer: number | undefined;

  (async () => {
    state.cfg = await getSettings();
    state.theme = await getTheme();
    applyAll();
    // Re-apply regularly so newly opened Steam windows / navigations get styled too.
    timer = window.setInterval(applyAll, 3000);
    if (state.cfg.auto_update) await checkForUpdates(false, true);
  })();

  return {
    name: "ShatteredUI",
    titleView: <div className={staticClasses.Title}>ShatteredUI</div>,
    content: <Content />,
    icon: <FaThLarge />,
    onDismount() {
      if (timer) window.clearInterval(timer);
      removeAll();
    },
  };
});
