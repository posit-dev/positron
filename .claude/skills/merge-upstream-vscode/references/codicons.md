# Codicons

Positron has added its own codicons to Code OSS, which generates merge conflicts
with upstream.

If there is a conflict in `codicon.ttf` or `codiconLibrary.ts`, then the
codicons need to be rebuilt to incorporate both changes. This cannot be done in
the Positron repository alone, so:

- accept the incoming binary ttf file to fix the merge conflict
- clean up markers in `codiconLibrary.ts` so it contains both sets of icons
- note in the merge log file that codicons need to be rebuilt

## Locator drift: upstream repointing an icon breaks e2e locators

Separate from the blank-glyph problem above, upstream sometimes switches a UI
element from one codicon to another (e.g. the per-tab editor close button moved
from `Codicon.close` to `Codicon.closeSmall` in 1.134). The rendered CSS class
changes with it (`codicon-close` -> `codicon-close-small`), so any Positron e2e
test or page object that locates the element by its `.codicon-*` class silently
stops matching and the action times out. This breaks even when the font and glyph
are perfectly correct -- it is a name change, not a rendering problem, so the
blank-glyph checks won't surface it.

After a merge, grep the e2e code (`test/e2e/`) for `.codicon-` locators on any
element the merge touched, and confirm the class the app now renders still
matches. A close-button or action-icon locator that used to work is the usual
casualty.
