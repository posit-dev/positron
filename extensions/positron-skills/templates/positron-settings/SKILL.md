---
name: positron-settings
description: >
  Inspecting the user's current Positron configuration, read live from this
  running Positron -- state, not documentation: docs pages, release notes,
  and settings.json file reads cannot answer these for this install; this
  skill's commands can. Use for: what the user has configured, what a setting
  is set to and where, why a setting they set is not taking effect, which
  features are in preview or experimental and what enables each, whether a
  setting exists, its default and allowed values. Triggers: "what settings do
  I have enabled", "which features are in preview", "why isn't this setting
  working", "what is X set to", "is there a setting for X".
---

# Positron settings

These commands read the running Positron's configuration -- what the user has
set, and what this build's settings registry knows. Two rules frame everything
in this skill:

1. **This is state, not documentation.** The user's configuration is live
   state in this running Positron. Do not fetch a documentation page, do not
   read release notes, and do not read a `settings.json` file to answer what
   is configured or what is in preview: none of those can know what this
   install has. Query it.
2. **Never claim you cannot inspect settings.** You can, with the commands in
   this skill. When the payload has a limit, say what it does and does not
   show (the reference file spells those limits out) instead of deflecting to
   "I can't see your settings from here" or sending the user to click through
   the UI for an answer you can query.

## Calling these commands

Invoke commands with the `positronCommand` tool, passing the command's literal
`id` exactly as written in the reference files -- copy it, do not retype it from
memory. Where a command takes arguments, fill `args` positionally in the order
given under that command's "Arguments" entry. Omit `args` entirely when using
none -- do not pass an empty object or array. Never invent an argument value the
user hasn't given you or that isn't documented.

## When a command doesn't work

- **`not-found`**: the command id isn't present in this Positron build, meaning
  the build is older or newer than this skill expects. Report this plainly; do
  not substitute a similarly named id you're unsure about.
- Neither command here has a precondition: there is always a configuration,
  even when the user has set nothing, so a `disabled` failure is unexpected.
  Report it plainly if it ever appears.

## When a result is truncated

Truncation is a field to read, not a shape to infer. If a command response has
a top-level `truncated` object, the transport cut the result to fit its budget
and is telling you so: `truncated.field` names the list that was cut, and you
received `truncated.returned` of `truncated.total` entries. Say how many
entries are missing rather than presenting the list as complete, and narrow
the request (a `filter`, a `limit`, explicit `keys`) to get the rest. If
`truncated.preview` is true, `result` is cut JSON handed to you as a string:
do not parse it, say the result was too large, and narrow the request. No
`truncated` object means nothing was cut.

## Reference Files

**Configuration** -- [references/configuration.md]({{skill_dir}}/references/configuration.md)
Read when the user asks which settings they have configured, what a setting is
set to, why a setting they set is not taking effect, which features are in
preview or experimental, whether a setting exists, or what a setting's default
or allowed values are. Also carries the known settings-that-gate-other-settings
relationships (the AI feature switches), which no single payload can reveal.
