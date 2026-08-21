# Positron data connection commands

Reading the data connections the user has configured, fetching the code that
opens one, and walking the schema -- the tables and columns -- of a connection
that is currently live. See
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
snippet `positronDataConnections.getConnectionCode` hands you, and running the
final query.

## How these commands report trouble

All three commands are always callable: none has a precondition, so none ever
fails the *call* the way [SKILL.md]({{skill_dir}}/SKILL.md) describes -- you will
not see its command-level `disabled` (command gated off) or `not-found` (command
absent from this build) outcomes for these three. **They report trouble inside
the payload instead** -- an empty array, or an object with `connected: false` or
`available: false` and a `reason`. So a successful call tells you nothing on its
own; read the payload before concluding anything, and never read an empty result
as "the user has no data connections."

Two of those payload `reason` values reuse the names `disabled` and `not-found`,
and they mean something different from the command-level outcomes: in a payload,
`disabled` is the `dataConnections.enabled` setting being off, and `not-found` is
a `profileId` no saved profile has. Read them as described under each command
below -- a payload `not-found` calls for re-reading the catalog, not for
concluding the command is missing from this build.

This matters because the whole feature is behind the `dataConnections.enabled`
setting, which is preview and **off by default** and needs a window reload to
take effect. With it off, all three commands still exist and still succeed --
they just report nothing.

## Reading the user's configured connections

### `positronDataConnections.getConnections`

Lists every connection profile the user has saved, whether or not it is
currently connected. This is the cold-start entry point: it needs no live
connection, so reach for it first whenever the user refers to "my database",
"my warehouse", or a connection by name.

This is a catalog, not the full detail: each entry is a `profileId`, a
`connected` flag, and one `summary` line holding everything else, in the form

```
name=Sales DW | driver=snowflake | mechanism=odbc | languages=r, python | parameters=account=ab1234, user=analyst, password=****
```

Read the connection's name from `name=` when the user refers to it by name, and
`languages=` to see which languages this connection can be opened from -- those
are the ids `positronDataConnections.getConnectionCode` will accept. The
driver's own parameters are all inside the single `parameters=` field, so a
driver whose parameter happens to be named `driver` can't be mistaken for the
`driver=` field itself; split that field at its first `=` only. A value
containing a `|`, `,` or `=` is quoted as a JSON string, so
`dsn="Driver={ODBC},Server=db"` is one parameter, not two.

**No connection code comes back from this command.** Generating it costs a round
trip to each driver for each language, and answering "which connections do I
have?" needs none of it. Once you know which profile the user means, ask
`positronDataConnections.getConnectionCode` for that one.

**`languages=` may be missing** from a profile's summary. That means the driver's
extension isn't installed or hasn't activated yet, so no code can be generated
for it. Report that; don't retry, and don't fall back to writing connection code
yourself.

**The parameters are secret-free, by design.** A secret parameter appears in
`parameters=` only in redacted display form (e.g. `password=****`), or not at
all. Never invent, guess, or prompt for a credential to fill one in.

{{command:positronDataConnections.getConnections}}

## Reading the code that opens a connection

### `positronDataConnections.getConnectionCode`

Returns the user's own connection code for **one** profile, under
`languages[<languageId>].code`, along with the `variableName` that code binds the
connection to (e.g. `conn`, `con`, `engine`, `board`). To actually run it, pass
it to `executeCode` as written -- there is no command for opening a connection,
and you should not imply otherwise. Treat the snippet as the driver's answer to
"how do I open this connection", not as a starting point to edit.

**Name the `languageId`** whenever you know which session the user is working
in. Left out, every language the driver supports is generated -- usually two, so
the payload is roughly twice the size and the extra half is code you will not
run.

**The code is secret-free, by design.** It is always the redacted preview, so for
a driver that needs a password, running the snippet verbatim will fail. Do not
invent, guess, or prompt for credentials to patch it up: point the user at the
Data Connections pane's Connect action, which supplies the secret itself, and
then work against the resulting live connection.

**What each `reason` means when `available: false`:**

- **`disabled`** -- the `dataConnections.enabled` setting is off. Tell the user
  to enable it and reload the window.
- **`not-found`** -- no saved profile has that `profileId`. Re-read the catalog
  rather than guessing at another id.
- **`no-driver`** -- the profile's driver extension isn't installed, or hasn't
  activated yet. The same condition the catalog reports by leaving `languages=`
  out. Report it; don't write the connection code yourself.
- **`no-code`** -- the driver produced nothing. Usually the `languageId` asked
  for isn't one it supports: `supportedLanguageIds` says what is, so retry with
  one of those. If you asked for a supported language and still got this,
  generation failed for the profile's current parameters -- report that.

{{command:positronDataConnections.getConnectionCode}}

## Reading a live connection's schema

### `positronDataConnections.getSchema`

Walks a live connection and returns a bounded, one-line-per-object listing of
its schema -- databases, schemas, tables, and columns with their data types. Use
it before writing a query, so table and column names come from the real schema
rather than from a guess.

**Reading a line.** Each entry in `lines` is
`<path> [<kind>][ <dataType>][ PK][ (<column>:<type>, ...)][ +<n> more]`: the
dot-joined path from the root, the object's kind, and -- for a table or view --
its columns folded onto the same line. So

```
sales.public [schema]
sales.public.orders [table] (order_id:integer PK, customer_id:integer, total:numeric)
sales.public.events [table] (id:bigint PK) +37 more
```

means the `orders` table has three columns, `order_id` is its primary key, and
37 of `events`' columns were left out by a cap. The path is already the
qualified name a query wants. A name containing a `.`, `,`, `:`, bracket or
space is quoted as a JSON string, so `"sales.2024" [table]` is one table whose
name contains a dot, and `"Order Details" [table]` one whose name contains a
space.

This shape is deliberately compact: a nested JSON tree of the same schema costs
roughly twice the characters, and the tool that hands you this result truncates
long payloads, so the difference is schema you either see or lose.

**When to pass `profileId`:** omit it when exactly one connection is live and
you want that one. Pass it when you have a specific connection in mind -- take
the `profileId` from `positronDataConnections.getConnections`, or from
`liveProfileIds` after an `ambiguous` result. The command never picks between
several live connections on your behalf.

**The caps and `truncated`:** `maxDepth`, `maxNodesPerLevel`, and
`maxTotalNodes` all default to a modest bound. Omit them and react to the
result rather than pre-tuning: `truncated: true` at the top level means some
cap left objects out somewhere, and a `+<n> more` on an individual line says how
many of *that* object's children were dropped. If what you need was cut,
raise the one cap that explains it -- a deep tree wants `maxDepth`, a wide
table list wants `maxNodesPerLevel` -- or narrow the walk with `profileId`.
Raising all three at once turns a cheap call into an expensive one.

Note that a line gives an object's name, kind, and data type, but not a
column's own description. If the user asks what a column *means*, say the schema
summary doesn't carry that.

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
   means, by the `name=` field of its `summary`.
2. If that profile's `connected` is already `true`, skip to step 5.
3. Otherwise the connection needs opening. If the `summary`'s `parameters=`
   shows a redacted secret (e.g. `password=****`), no generated code will run
   as-is -- send the
   user to the Data Connections pane's Connect action, and skip to step 5 once
   they have connected.
4. If there is no secret, call `positronDataConnections.getConnectionCode` with
   that `profileId` and the `languageId` of the session the user is working in,
   and run `languages[<languageId>].code` with `executeCode` **verbatim** -- do
   not rewrite it or refill its arguments from the summary yourself. The driver
   generated that snippet from the profile, so it already carries the right
   call, arguments, and defaults; a hand-written equivalent silently drops
   whatever the driver knew that you don't. Keep the `variableName` it reports.
5. Call `positronDataConnections.getSchema` (with `profileId` if more than one
   connection is live) and read the tables and columns you need from `lines`.
6. Write the query against those real names and run it with `executeCode`,
   referring to the connection by the `variableName` from step 4. If you skipped
   step 4 -- the profile was already `connected`, or the user connected from the
   pane -- you have no `variableName`: nothing in the `getConnections` payload
   carries one. Call `positronDataConnections.getConnectionCode` for that
   `profileId` to see the name the driver's own snippet binds, which is the name
   the pane's Connect action uses too, and confirm it exists in the session
   before querying through it. Never guess `conn`.
