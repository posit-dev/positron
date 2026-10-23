# Themes and Default-On UI Changes

Positron's default themes, `positron_light.json` and `positron_dark.json` in `extensions/theme-defaults/themes/`, `include` the upstream `light_modern.json` / `dark_modern.json` and override a small set of colors, most notably a colored activity bar (`#3A78B1` light, `#32485B` dark). Every other color, including every new color upstream adds, is inherited from a theme designed for upstream's neutral grey chrome.

Theme regressions don't conflict, compile, or fail tests. Either the merged theme files are identical to upstream, or the upstream CSS changes in a file Positron doesn't touch. They only show up when someone looks at the running app.

## What to check

### Settings that flip to default-on

Upstream ships redesigns behind settings and later turns them on by default. When that happens, a whole layer of CSS and new theme colors starts applying to Positron users at once. Look for any boolean in the merge diff whose `'default'` changed from `false` to `true`, especially `workbench.experimental.*`:

```bash
git diff <merge-base> --cached -- src/vs/workbench/browser/workbench.contribution.ts | grep -n -B4 "'default': true"
```

Example: 1.143 turned on `workbench.experimental.modernUI`. With it on, the activity bar drops its left-border indicator for a filled box using `modernActivityBarItem.*`, and editor tabs default to the connected style, which uses `editorGroupHeader.connectedTabsBackground`.

### New colors in the inherited themes

Diff the upstream themes Positron includes and list every newly added color key:

```bash
git diff <merge-base> --cached -- extensions/theme-defaults/themes/light_modern.json extensions/theme-defaults/themes/dark_modern.json
```

Also check `registerColor` additions in `src/vs/workbench/common/theme.ts`. A new key with no value in the theme files falls back to its registered default, which is often a list or foreground color. For each new key, ask whether its value still makes sense with the Positron overrides:

- **Colors drawn on the activity bar.** Upstream's light theme uses opaque near-white or grey values, meant for a light grey bar. On Positron's blue bar they show as a white block with a dark icon. Override with translucent white backgrounds and foregrounds that match `activityBar.foreground`.
- **Foregrounds with no value in the theme.** These fall back to the generic `foreground` (`#CCCCCC` in dark) instead of the activity bar's tinted `#C1D6E8`. Set them explicitly.
- **A new color that takes over an old one.** For example, `editorGroupHeader.connectedTabsBackground` now paints the tab strip, while inactive tabs still use `tab.inactiveBackground`. Upstream gave the two different values, so inactive tabs no longer blend into the strip. Before the merge, Positron's title bar was a single color (`#F8F8F8` light, `#181818` dark), so set the new color to match. Don't override the tab color to match the new strip: the tab element and its fill are painted by separate rules, and that approach looked wrong.

### Look at it

Smoke-launch with both Default Positron Light and Default Positron Dark and compare against the previous release:

- the activity bar: active, hovered, and inactive items, plus its border
- the editor tab strip: active, inactive, and hovered tabs, and the empty strip area to the right of the tabs
- the panel and side bar headers

When a color looks off, find the variable that actually paints the element in DevTools. Rules from the older CSS are often still listed but overridden by the redesign's CSS (e.g. `.tab` is set to `transparent !important` and a `.tab-fill` child paints the color), so the first matching rule is not necessarily the one in effect.

## How to fix

- Put overrides in `positron_light.json` / `positron_dark.json` (Positron-owned), keeping keys alphabetical. Don't edit `light_modern.json` / `dark_modern.json` or the redesign's CSS: those are upstream files.
- Fix the theme even if Positron later disables the new setting by default; users can still turn it on.
- Whether Positron keeps an upstream redesign on by default is a product decision. Raise it with the user rather than overriding the setting default yourself.
- Record each override and the reason in the merge log.
