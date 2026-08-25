# Positron settings commands

Finding out which settings the user has actually configured, and why a setting
they set is not taking effect. See [SKILL.md]({{skill_dir}}/SKILL.md) for how to
call these commands and how to handle failures.

The **Arguments** and **Returns** entries below are generated from the running
build's command metadata, so they always match this Positron. The surrounding
guidance is hand-written.

## Diagnosing settings that are not taking effect

### `positronSettings.getConfiguredSettings`

Reports the settings the user has explicitly set, the value each configuration
target holds for them, and an explicit reason when a setting they set is having
no effect. Read this instead of guessing at a value, and instead of asking the
user to paste their `settings.json`.

Do not try to read the settings file yourself. Its location differs by
deployment, and on Posit Workbench a read of the usual user-data location does
not fail: it succeeds against a different, usually empty store, so you get a
confidently wrong answer on exactly the deployment where this matters most. This
command names no file path and is correct everywhere.

No precondition. There is always a configuration, even when the user has set
nothing. Takes no arguments.

{{command:positronSettings.getConfiguredSettings}}

**Worked flow -- "why isn't this setting working?":**

1. Call `positronSettings.getConfiguredSettings` and find the one setting key
   the user asked about in the returned `settings` list.
2. If the setting has an `ignored` entry, that is the answer. Report the reason
   in the user's own terms, and note that `value` is the value actually in
   force, while what they wrote is in `sources`:
   - `overridden-by-policy`: an administrator, or an account entitlement tied
     to sign-in state, enforces this setting, and `sources.policy` is the
     value it is pinned to. The user's own entry does nothing, and changing it
     will not help. Do not assert which of the two it is; the payload does not
     say.
3. If the key is absent from `settings` entirely, this usually means the user
   has not set it anywhere, but it is not proof. This deployment's
   configuration model can filter out a setting the user genuinely wrote,
   before this command ever sees it, in two cases:
   - `deployment.remote` is true and the setting is machine-scoped: it may
     be sitting in the user's local settings, which do not own that scope
     on a remote connection (SSH, a container, or Posit Workbench).
   - `deployment.defaultProfile` is false and the setting is
     application-scoped: it may be sitting in the current profile's
     settings, which do not own that scope outside the default profile.
   Check `deployment` before answering. When one of these cases could apply,
   say plainly that the payload does not show the key, that this usually
   means the user has not set it, but that you cannot rule out the
   deployment having filtered it, and suggest they check the relevant
   settings file directly. Only assert "you have not set this" outright
   when neither case applies.
4. If an entry -- one you were hunting for, or one that simply turned up while
   you were listing what the user has set -- carries `registered: false`, this
   Positron's configuration registry does not know that key. That can mean any
   of three things, and you cannot tell which from this payload alone:
   - a typo,
   - a setting contributed by an extension that is not installed in this
     window, or
   - a setting an INSTALLED extension reads without declaring it in its own
     manifest. `assistant.experimentalFeatures` is exactly this case: the
     Posit Assistant extension reads it at runtime even though it never
     registers it with this Positron's configuration registry, so it is fully
     live and does something, despite `registered: false`.
   Say more than one is possible rather than picking one, and if a nearby key
   looks like what the user meant, name it as one possibility, not the answer.
   **`registered: false` means only that this Positron's configuration
   registry does not know the key. It says NOTHING about whether anything
   reads it. Never conclude from `registered: false` that a setting is inert,
   has no effect, is doing nothing, or is safe to delete.**
5. Never report a `<redacted>` value as if it were the real one, and never ask
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

If a result still looks cut off -- the entry list ends mid-object, or a value
is truncated -- say so to the user rather than presenting what you have as the
complete picture. This command returns every setting the user has configured
in one call, with no way to narrow the request, so a user who has configured a
great deal can still produce a large result.

**Worked flow -- "which settings do I have set?" (or "what X settings do I
have?"):** call `positronSettings.getConfiguredSettings` and pick the matching
entries yourself out of the full `settings` list. Every entry in the list is a
key the user touched; `value` for a key like `"[r]"` is only the part they
themselves set, never a default shipped by an extension for that language.
Mention `ignored` entries even when the user did not ask about them, since a
setting that is silently doing nothing is usually news. Apply step 4 above
here too: an entry with `registered: false` in this list is not automatically
inert, since an installed extension may read it without declaring it.
