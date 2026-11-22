# ShatteredUI (Decky plugin)

PS5-style Gaming Mode home/library with square capsule art (SteamGridDB compatible),
themed by CSS pulled from a GitHub repo so you can update without rebuilding the plugin.

## Repo layout (BigHalalChickenProductions/shatteredui)
Push the files in `repo-template/` to the root of the repo's `main` branch:

    manifest.json   {"version": "0.1.0", "css": ["shattered.css"]}
    shattered.css

Bump `version` in manifest.json whenever you change the CSS. The plugin only re-downloads
when the version differs (the "Check for updates" button forces a refresh).

Only raw.githubusercontent.com is fetched. CSS containing @import, javascript:, or url()
pointing anywhere except data: / raw.githubusercontent.com is rejected.

## Build
    pnpm i
    pnpm build
Copy plugin.json, main.py, package.json, defaults/ and dist/ to
~/homebrew/plugins/ShatteredUI on the Deck, then: sudo systemctl restart plugin_loader
If your Decky version differs, start from the official decky-plugin-template and drop in
src/index.tsx, main.py, plugin.json and defaults/.

## Square capsules
Use the SteamGridDB Decky plugin to set square (1:1) grids. Steam stores them as the portrait
capsule asset; ShatteredUI's CSS reshapes that container to 1:1 and cover-fits the image.

## Tuning selectors
Steam's class names are hashed per build. Selectors use [class*="prefix_"] and will likely need
adjusting; enable CEF debugging in Decky developer settings and inspect at http://DECK_IP:8081.
