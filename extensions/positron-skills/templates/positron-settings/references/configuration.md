# Positron configuration commands

Finding out which settings the user has actually configured, why a setting
they set is not taking effect, and what this build's settings registry knows:
which settings exist, what each does, its default, and which are preview or
experimental. See [SKILL.md]({{skill_dir}}/SKILL.md) for how to call these
commands, how to handle failures, and how to read a truncated result.

The **Arguments** and **Returns** entries below are generated from the running
build's command metadata, so they always match this Positron. The surrounding
guidance is hand-written.

## Which command answers which question

- **What has the user set?** -- `positronSettings.getConfiguredSettings`. It
  returns only keys the user explicitly configured.
- **What does this setting do, what is its default, does it exist, what is it
  currently set to even if the user never touched it?** --
  `positronSettings.findSettings`. It searches the registry of every setting
  this build knows, configured or not.
- **Which features are in preview?** -- `positronSettings.findSettings` with
  the `tag` argument. This is a fact of this build's registry; release notes
  and documentation pages cannot answer it for this install.

## Anti-patterns

Each row below is a move that was actually observed going wrong. Do not remove
a row without checking its reason still cannot happen.

| Do not | Because (observed) |
|---|---|
| webfetch docs or release notes to answer what is configured or what is in preview | Observed: a "which features are in preview" question answered by fetching release-notes pages, which describe releases, not this build's state. |
| read a `settings.json` path | Observed: a path read that happened to be right on desktop macOS. The user-data location differs by deployment, and on Posit Workbench the usual path succeeds against a different, usually empty store -- confidently wrong exactly where it matters most. These commands name no file path and are correct everywhere. |
| read files under the extension install directory to find configuration | Observed: an 87-line read of an extension's install tree that answered nothing. Install trees hold code, not the user's configuration. |
| tell the user to go look in the UI when you can query | Observed: "finding your configured providers is easy:" followed by click-path directions, in place of the answer. |
| say "I can't directly inspect your settings from here" | Observed, and false once this skill is loaded. Query, then state what the payload does and does not show. |
| ask the user to paste their settings file | `getConfiguredSettings` already reports it, with provenance the raw file does not carry. |

## Settings that gate other settings

No payload can reveal that one setting silently disables another; these
relationships are listed here because they cannot be derived mechanically.
When you report a setting from the families below, check its gates in the same
payload and call out a conflict even when the user did not ask:

- `ai.enabled` is the main switch over every AI feature in Positron (Posit
  Assistant, notebook AI, ghost cells, console Fix/Explain, and the rest).
  With it off, enabling any individual AI feature setting does nothing.
- Posit Assistant is on only when **both** `assistant.enabled` and
  `ai.enabled` are true.
- `positron.assistant.notebook.ghostCellSuggestions.enabled` is gated by
  `notebook.ai.enabled` (and by `ai.enabled` above that): ghost cell
  suggestions turned on while notebook AI is off is a conflict, and ghost
  cells will not appear.
- `positron.assistant.enable` is deprecated, superseded by
  `assistant.enabled`. On Positron releases older than 2026.07, enablement was
  `positron.assistant.enable` and `ai.enabled` was not consulted at all --
  relevant when the user reports behavior from an older install.

## Reading what the user has configured

### `positronSettings.getConfiguredSettings`

Reports the settings the user has explicitly set, the value each configuration
target holds for them, and an explicit reason when a setting they set is having
no effect. Read this instead of guessing at a value, and instead of asking the
user to paste their `settings.json`.

No precondition. There is always a configuration, even when the user has set
nothing. Both arguments are optional: the plain no-argument call answers
"which settings do I have set".

{{command:positronSettings.getConfiguredSettings}}

**Worked flow -- "which settings do I have set?" (or "what X settings do I
have?"):**

1. Call `positronSettings.getConfiguredSettings`, unfiltered for the general
   question, or with `filter` when the user named an area (`filter: "ai"` for
   AI settings, and so on).
2. Group the entries by feature area and gloss each key **from its
   `description` field**, in plain terms ("the Positron notebook editor is
   on"). Do not gloss a key from memory: the description in the payload is
   this build's own text. An entry with no `description` is unregistered or
   undocumented -- say what the key and value suggest, flagged as a guess.
3. Lead with anything noteworthy even when the user did not ask: entries
   carrying `ignored` (set but silently doing nothing -- that is news) and
   entries carrying `deprecated` (the message usually names the replacement).
   The list is already ordered so these come first.
4. Check the "Settings that gate other settings" section above against what
   you see, and call out conflicts.
5. `value` for a language-override key like `"[r]"` is only the part the user
   themselves set, never a default shipped by an extension for that language.

**Worked flow -- "why isn't this setting working?":**

1. Call `positronSettings.getConfiguredSettings` (a `filter` on the key's
   prefix keeps the result small) and find the setting the user asked about.
2. If the entry has an `ignored` field, that is the answer. Report the reason
   in the user's own terms, and note that `value` is the value actually in
   force, while what they wrote is in `sources`:
   - `overridden-by-policy`: an administrator, or an account entitlement tied
     to sign-in state, enforces this setting, and `sources.policy` is the
     value it is pinned to. The user's own entry does nothing, and changing it
     will not help. Do not assert which of the two it is; the payload does not
     say.
3. If the entry is present and not ignored, check the gating section above:
   a setting can be in force and still do nothing because a switch above it is
   off. Fetch the gate's own entry (or its default via
   `positronSettings.findSettings`) before answering.
4. If the key is absent from `settings` entirely, this usually means the user
   has not set it anywhere, but it is not proof. This deployment's
   configuration model can filter out a setting the user genuinely wrote,
   before this command ever sees it, in two cases:
   - `deployment.remote` is true and the setting is machine-scoped: it may
     be sitting in the user's local settings, which do not own that scope
     on a remote connection (SSH, a container, or Posit Workbench).
   - `deployment.defaultProfile` is false and the setting is
     application-scoped: it may be sitting in the default profile's
     settings, which the current profile does not read.
   Check `deployment` before answering. When one of these cases could apply,
   say plainly that the payload does not show the key, that this usually
   means the user has not set it, but that you cannot rule out the
   deployment having filtered it, and suggest they check the relevant
   settings file directly. Only assert "you have not set this" outright
   when neither case applies.
5. If an entry -- one you were hunting for, or one that simply turned up while
   you were listing what the user has set -- carries `registered: false`, this
   Positron's configuration registry does not know that key. That can mean any
   of three things, and you cannot tell which from this payload alone:
   - a typo,
   - a setting contributed by an extension that is not installed in this
     window, or
   - a setting an INSTALLED extension reads without declaring it in its own
     manifest. `assistant.experimentalFeatures` is exactly this case: the
     Posit Assistant extension reads it at runtime even though it never
     registers it with this Positron's configuration registry -- and it does
     not even resolve from this payload's sources alone, since Posit
     Assistant folds in its own configuration tiers (enforced admin settings,
     `.posit/assistant/settings.json` files) that no Positron payload can
     see. So a key can read `registered: false`, appear in no source at all,
     and still be fully live and gating real behavior.
   Say more than one is possible rather than picking one, and if a nearby key
   looks like what the user meant, name it as one possibility, not the answer.
   **`registered: false` means only that this Positron's configuration
   registry does not know the key. It says NOTHING about whether anything
   reads it. Never conclude from `registered: false` that a setting is inert,
   has no effect, is doing nothing, or is safe to delete.**
6. Never report a `<redacted>` value as if it were the real one, and never ask
   the user to paste the value back to you.

**Reading the compact payload shape:** an entry omits a field rather than
carrying an empty or default value for it, so treat absence as meaningful, not
as unknown:

- No `registered` field means the key **is** registered. `registered` is only
  present, and only ever `false`, for a key this Positron does not know. Do
  not read a missing `registered` as false -- that would call every setting a
  typo.
- No `sources` field means exactly one configuration target carries a value,
  and `effectiveSource` names it; that target's value is `value`. `sources` is
  only present when more than one target carries a value, so you can see all
  of them and which one won.
- No `redactedCount` field means nothing was redacted.
- No `distinctFolderValues` field means the reported value is not being
  contradicted by another workspace folder. When it is present, this key
  resolves to that many different values across a multi-root workspace's
  folders (folders setting it differently, or one folder overriding a value
  the others inherit): the entry carries one folder's resolution, and the
  effective value depends on which folder a file belongs to, so say that
  rather than presenting the one value as the answer.

## Searching the settings registry

### `positronSettings.findSettings`

Searches every setting this build registers, configured or not: what a setting
does, its type, default, current value, allowed values, and its tags. This is
the command for questions `getConfiguredSettings` cannot answer -- settings the
user has *not* set, defaults, enum values, and the preview/experimental
listing.

No precondition. All arguments are optional, but an unfiltered call returns an
arbitrary slice of a registry with thousands of entries, so always pass a
`query`, `keys`, or `tag`.

{{command:positronSettings.findSettings}}

**Worked flow -- "which features are in preview and what enables them?":**

1. Call `positronSettings.findSettings` twice, with `tag: "preview"` and
   `tag: "experimental"`. Positron uses both tags; report them under the
   user's word but say which is which, since experimental is the less stable
   tier.
2. For each entry, report the key as the setting that enables the feature,
   glossed from its `description`, with its `default` and, when present, the
   current `value`.
3. An entry with `hidden` set is excluded from the Settings editor UI: tell
   the user it will not appear when browsing settings there and must be set in
   `settings.json` directly.
4. Do not supplement this list from documentation or release notes. The
   registry is this build's own inventory; prose sources describe releases,
   not this install, and the two disagree whenever the build is older or newer
   than the page.

**Worked flow -- enriching a configured-settings listing:** when
`getConfiguredSettings` returns entries you need more depth on (no
description because the caller opted out, or the user asks what else a
setting could be set to), call `findSettings` with `keys` set to exactly
those keys. The entries come back in your order, with `registered: false`
standing in for any key the registry does not know.

**Reading the result:**

- `total` is the full match count; when it exceeds the entries returned, say
  the listing is partial and how many more matched, and narrow the query
  rather than presenting a slice as everything.
- `value` is present only when the current effective value differs from
  `default`; its absence means the default is in force. That does not say who
  set a differing value, and it is resolved without a file context, so a
  resource-scoped setting overridden in a workspace folder can resolve
  differently for files in that folder than `value` shows. For provenance
  (user vs workspace vs policy) and the per-folder picture, look the key up
  in `getConfiguredSettings`.
- The two commands' vocabularies match where they overlap (`key`,
  `description`, `deprecated`, `registered`, `<redacted>`), so entries can be
  merged key-by-key without translation.
