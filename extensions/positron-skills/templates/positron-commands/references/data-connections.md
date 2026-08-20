# Positron data connection commands

Reading the data connections the user has configured, and walking the schema --
the tables and columns -- of a connection that is currently live. See
[SKILL.md]({{skill_dir}}/SKILL.md) for how to call these commands.

The **Arguments** and **Returns** entries below are generated from the running
build's command metadata, so they always match this Positron. The surrounding
guidance is hand-written.

## Two different panes, and only one of them is this

Positron has two panes with similar names, and they work in opposite directions:

- **Data Connections** (what these commands read) -- connections the user
  *configured in Positron itself*. They live in Positron's own configuration,
  exist whether or not any interpreter is running, and are the subject of this
  file.
- **Connections** (not covered here) -- connections *a running session opened*,
  which appear because the user's R or Python code created them. Nothing in this
  file reads or affects that pane.

If the user's connection came from code they ran, it is in the second pane and
these commands will not show it. Say so plainly rather than reporting that they
have no connections.

## Do not look for these connections by running code

A configured Data Connections profile is **invisible to code running in the
session**. It is Positron configuration, not session state, so no amount of
`executeCode` will find it: not listing DBI or `odbc` connections, not
inspecting session variables, not reading environment variables or a
`.Renviron`. Running code to answer "what connections do I have?" produces a
confident wrong answer, because an empty result there says nothing about what
the user has configured.

`positronDataConnections.getConnections` is the only way to see them. Call it
first, before any code. `executeCode` has exactly two jobs in this area, both
of them *after* a command has told you what exists: running the connection
snippet a profile hands you, and running the final query.

## How these two commands report trouble

Both commands are always callable: neither has a precondition, so neither ever
returns the `disabled` or `not-found` failures described in
[SKILL.md]({{skill_dir}}/SKILL.md). **They report trouble inside the payload
instead** -- an empty array, or an object with `connected: false` and a
`reason`. So a successful call tells you nothing on its own; read the payload
before concluding anything, and never read an empty result as "the user has no
data connections."

This matters because the whole feature is behind the `dataConnections.enabled`
setting, which is preview and **off by default** and needs a window reload to
take effect. With it off, both commands still exist and still succeed -- they
just report nothing.

## Reading the user's configured connections

### `positronDataConnections.getConnections`

Lists every connection profile the user has saved, whether or not it is
currently connected. This is the cold-start entry point: it needs no live
connection, so reach for it first whenever the user refers to "my database",
"my warehouse", or a connection by name.

Each profile carries the user's own connection code, per language, under
`languages[<languageId>].code`, along with the `variableName` that code binds
the connection to (e.g. `conn`, `con`, `engine`, `board`). To actually run that
code, pass it to `executeCode` as written -- there is no command for opening a
connection, and you should not imply otherwise. Treat the snippet as the
driver's answer to "how do I open this connection", not as a starting point to
edit.

**The code is secret-free, by design.** `code` is always the redacted preview,
and `parameterValues` contains secrets only in redacted display form (or not at
all). For a driver that needs a password, running the snippet verbatim will
fail. Do not invent, guess, or prompt for credentials to patch it up: point the
user at the Data Connections pane's Connect action, which supplies the secret
itself, and then work against the resulting live connection.

**`languages` may be empty** for a profile. That means the driver's extension
isn't installed or hasn't activated yet, so no code could be generated. Report
that; don't retry, and don't fall back to writing connection code yourself.

{{command:positronDataConnections.getConnections}}

## Reading a live connection's schema

### `positronDataConnections.getSchema`

Walks a live connection and returns a bounded tree of its schema nodes --
databases, schemas, tables, and columns with their data types. Use it before
writing a query, so table and column names come from the real schema rather
than from a guess.

**When to pass `profileId`:** omit it when exactly one connection is live and
you want that one. Pass it when you have a specific connection in mind -- take
the `profileId` from `positronDataConnections.getConnections`, or from
`liveProfileIds` after an `ambiguous` result. The command never picks between
several live connections on your behalf.

**The caps and `truncated`:** `maxDepth`, `maxNodesPerLevel`, and
`maxTotalNodes` all default to a modest bound. Omit them and react to the
result rather than pre-tuning: `truncated: true` at the top level means some
cap left nodes out somewhere, and `truncatedChildCount` on an individual node
says how many of *that* node's children were dropped. If what you need was cut,
raise the one cap that explains it -- a deep tree wants `maxDepth`, a wide
table list wants `maxNodesPerLevel` -- or narrow the walk with `profileId`.
Raising all three at once turns a cheap call into an expensive one.

Note that the summary gives each node's `name`, `kind`, and `dataType`, but not
a column's own description. If the user asks what a column *means*, say the
schema summary doesn't carry that.

**What each `reason` means when `connected: false`:**

- **`disabled`** -- the `dataConnections.enabled` setting is off. Tell the user
  to enable it and reload the window. Nothing else will work until then.
- **`no-live-connections`** -- the feature is on, but nothing is connected.
  Call `positronDataConnections.getConnections` to see what's configured, and
  send the user to the Data Connections pane to connect one.
- **`not-connected`** -- the `profileId` you passed exists but isn't connected.
  Don't try a different profile silently; either name the connection the user
  meant, or ask them to connect this one.
- **`ambiguous`** -- several connections are live and you named none. Retry with
  one of the `liveProfileIds`, asking the user which they meant if it isn't
  clear from context.

{{command:positronDataConnections.getSchema}}

## Worked flow -- an empty `getConnections` is ambiguous

An empty array from `positronDataConnections.getConnections` has two very
different causes: the user has no connection configured, *or*
`dataConnections.enabled` is off so the payload is suppressed. One
`positronDataConnections.getSchema` call separates them:

1. Call `positronDataConnections.getConnections`. If the array is non-empty,
   this flow doesn't apply.
2. Call `positronDataConnections.getSchema` with no arguments.
3. `reason: 'disabled'` means the feature is off -- tell the user to turn on
   `dataConnections.enabled` and reload the window.
4. `reason: 'no-live-connections'` means the feature is on and the user simply
   hasn't set up a connection yet.

Do not assert either cause without step 2. Guessing wrong sends the user
looking for a connection they never made, or hunting a setting that was already
on.

## Worked flow -- from cold start to a query

1. Call `positronDataConnections.getConnections`. Pick the profile the user
   means (by `connectionName`), and the language entry matching the session
   they're working in.
2. If that profile's `connected` is already `true`, skip to step 4.
3. Otherwise the connection needs opening. If `parameterValues` shows a
   redacted secret, the generated `code` cannot run as-is -- send the user to
   the Data Connections pane's Connect action. If there is no secret, run
   `languages[<languageId>].code` with `executeCode` **verbatim** -- do not
   rewrite it or refill its arguments from `parameterValues` yourself. The
   driver generated that snippet from the profile, so it already carries the
   right call, arguments, and defaults; a hand-written equivalent silently
   drops whatever the driver knew that you don't.
4. Call `positronDataConnections.getSchema` (with `profileId` if more than one
   connection is live) and read the tables and columns you need from `nodes`.
5. Write the query against those real names and run it with `executeCode`,
   referring to the connection by the `variableName` reported in step 1.
