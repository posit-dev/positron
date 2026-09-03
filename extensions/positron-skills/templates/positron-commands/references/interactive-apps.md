# Positron interactive web app commands

Running an interactive web app -- Dash, FastAPI, Flask, Gradio, marimo,
Streamlit, or Shiny -- through Positron's Run App feature. See
[SKILL.md]({{skill_dir}}/SKILL.md) for how to call these commands and how to
handle failures.

The **Arguments** and **Returns** entries below are generated from the command
metadata this build and its installed extensions publish, so they always match
this Positron. The surrounding guidance is hand-written.

## Never run an app server yourself

Do not start an app server with `executeCode` or a raw terminal command
(`python app.py`, `flask run`, `shiny run`, and so on). A raw run blocks a
console or leaves an orphaned server, skips Positron's URL detection and any
proxying the environment requires, and the app never reaches the Viewer.
{{#if pwb}}
On Posit Workbench -- where this session is running -- a raw run is worse than
untidy: the `localhost` URL it prints is **not reachable from the user's
browser at all**, and several frameworks additionally need base-path or proxy
configuration that these commands apply automatically. An app that "doesn't
load" after a raw run is not a bug in the app: do not modify the app, change
its port, or add workarounds -- re-run it with the matching command below.
{{/if}}
The commands below run the app the way Positron's play button does: a managed
terminal (or console for Shiny for R), automatic URL detection, any proxying
the environment requires, and a preview in the Viewer.

## The flow

1. **Identify the framework** from the app file's imports (`import dash`,
   `from flask import`, `from shiny import`, `import marimo`,
   `library(shiny)`, ...). If you cannot tell which framework a file uses, ask
   the user rather than guessing.
2. **Run the matching command** from the sections below, passing the app
   file's URI. (The Shiny commands are the exception: they run the active
   editor's file -- see their section.) Wait for the command to resolve; app
   startup can take a while.
3. **Tell the user where the app opened.** Every command previews the app
   once its URL is detected -- in the Viewer pane by default, but the user's
   preview mode setting can point it at an editor tab or their own browser
   instead, so say "the Viewer" only when you know that is where it went (see
   "Where the app opens" below). Either way do not tell the user to open the
   URL to see their app. Report the returned URL as the address for opening
   the app in a full browser tab{{#if pwb}}. It is a
   proxied URL whose path is made of opaque proxy segments that look nothing
   like the app's own routes -- report it exactly as returned; the path is
   not something to clean up{{/if}}.
4. **If the command returns nothing, read the app's terminal output (the
   console, for Shiny for R) before doing anything else.** A missing URL does
   not mean the app failed. It can mean the app is still starting, that URL
   detection timed out, that the run failed (Positron showed the user an error
   notification you cannot see), or that the user has turned previews off or
   is on a shell without shell integration -- in those last two cases no URL
   will ever be returned and no preview opens, however long you wait. A slow
   app can also simply outrun the detection timeout, which the user controls
   with `positron.runApp.urlDetectionTimeout`. So: if the output shows the app
   serving, tell the user it is running{{#if !pwb}} and report the URL it
   printed{{/if}} rather than re-running the command.
   {{#if pwb}}Do not report the `localhost` URL it printed -- the user's browser
   cannot reach it. Point them at the Workbench extension's Proxied Servers
   view instead.{{/if}} Only re-run when the output shows the app is not up,
   and say what the output reported rather than asserting the app is in the
   Viewer. For an app run in the console (Shiny for R), a timeout is not the
   end of it: Positron notifies the user and keeps watching, so the app may
   appear in the Viewer by itself a little later. Re-running would only
   restart an app that was about to show up.

The Python commands run whatever file you pass without checking its framework,
so a wrong URI or a mismatched command surfaces as a startup error or a
missing URL in the app's terminal, not upfront. Read the terminal output,
fix the URI or command, and re-run rather than switching to a raw terminal
run. A `disabled` result from a Shiny command means the active editor's file
was not recognized as a Shiny app.

Lifecycle: re-running a command restarts the app (Positron closes the app's
old terminal first). **You cannot stop a running app yourself**: no command
here stops an app server or kills a terminal (`shiny.stopApp` for Shiny is
the one exception). When the user wants an app stopped, tell them to press
the stop button in the Viewer pane when the app was previewed there, or to
kill the app's terminal -- it is named after the framework.

## Where the app opens

`positron.runApp.previewMode` decides what happens once the URL is detected.
It applies to the Python framework commands; Shiny is governed separately by
`shiny.previewType`.

| Value | What the user sees | Command returns |
| --- | --- | --- |
| `viewer` (default) | The Viewer pane | The URL |
| `editor` | A Simple Browser editor tab | The URL |
| `external` | Their own browser; the Viewer stays empty | The URL |
| `none` | No preview at all | Nothing, always |

`none` is the one that changes how you work: it turns URL detection off
entirely, so the command returns nothing however healthy the app is, and
waiting or re-running will not produce a URL. `external` matters less but
still makes "check the Viewer" the wrong thing to say.

You do not have to guess. When it matters where the app went -- before
telling the user which pane to look at, or after a run that returned nothing
-- read the setting with `positronSettings.getConfiguredSettings`, filtered
to `runApp` (see the Positron settings skill). A user who has not set it is
on `viewer`.

Two other settings shape the same moment:
`positron.runApp.urlDetectionTimeout` is how long Positron waits for the URL,
and turning off `terminal.integrated.shellIntegration.enabled` disables URL
detection for terminal-run apps altogether -- the app still runs, but Positron
never sees its URL and nothing previews.

{{#if !pwb}}
Note: on Posit Workbench, apps must be run through these commands to be
reachable at all; raw terminal runs print a `localhost` URL the user's
browser cannot reach. If the user asks whether their app will work there,
this is the difference to mention.
{{else}}
## Write proxy-safe app code

A running app is served through a path-rewriting proxy: the page the user
sees lives under the proxied URL's path, not at the app's own root. The proxy
strips that path before the request reaches the app and passes it along in the
`X-Forwarded-Prefix` header. An app that reads the header generates correct
URLs; an app that ignores it emits paths that escape the proxy path and land on
a Workbench error page instead of the app.

- **Flask: add Werkzeug's `ProxyFix`, then write ordinary Flask.** With the
  middleware in place `url_for` and `redirect(url_for(...))` produce correctly
  prefixed URLs, and `action="{{ url_for('add') }}"` is the right thing to put
  in a form. Nothing else about the app has to change. Guard it on
  `RS_SERVER_URL` so the same file still runs unchanged off Workbench:

  ```python
  app = Flask(__name__)
  if os.environ.get('RS_SERVER_URL'):
      from werkzeug.middleware.proxy_fix import ProxyFix
      app.wsgi_app = ProxyFix(app.wsgi_app, x_prefix=1)
  ```

- **Other frameworks:** use relative paths for form actions and redirects
  (`action="add"`, never `action="/add"`), unless the framework has its own way
  to be told its mount point. Positron sets `DASH_URL_BASE_PATHNAME` for Dash
  apps itself, so a Dash app must not set path-related `DASH_*` environment
  variables.

## Recognize proxy-related failures

When an app misbehaves here, check whether the proxy path explains it before
digging into the app's own logic.

- **A Workbench sign-in page, or a 404, where the app should be.** A
  root-absolute path escaped the proxy path: the browser asked the Workbench
  origin for `/add` rather than `<prefix>/add`. This is the most common
  failure and it usually appears on the second interaction (a form post, a
  link), not on first load.
- **The app loads but is unstyled, or images are missing.** The same cause,
  for `src` and `href`.
- **The prefix appears twice in a URL.** Over-correction: something is adding
  the prefix to a path that already carries it, e.g. `ProxyFix` on top of a
  hand-written prefix or a framework mount setting. Remove one of them, do not
  add a third.
- **A redirect or link lands on `localhost:<port>`.** An absolute URL built
  from the app's own host leaked out. In Flask this is `url_for(...,
  _external=True)`; add `x_host=1` to `ProxyFix`.
- **The page renders but never connects** (a spinner, "Connecting...",
  websocket errors in the browser console). This is the websocket, not HTTP,
  and app code usually cannot fix it. Streamlit on Workbench with SSL enabled
  is a known instance.
- **FastAPI's `/docs` renders but reports "Failed to load API definition".**
  Swagger fetches `/openapi.json` from the origin root. Fixing it needs
  uvicorn's `--root-path`, which the run commands do not pass; report it as a
  known limitation rather than editing the user's app.

Not every URL-shaped symptom is the proxy. A page that displays a path as
plain text is a Flask view returning `url_for(...)` where it should return
`redirect(url_for(...))` -- a string return value is the response body.

## Working on Posit Workbench

- In-session requests to `localhost` do work: you may smoke-test a running
  app with `curl http://localhost:<port>/...` from a terminal. The URL you
  report to the user must still be the one the run command returned.
- If the user insists on running from a terminal anyway, the app needs the
  same proxy-safe code as above, and it is opened from the Workbench
  extension's Proxied Servers view rather than the printed URL. See
  Workbench's "Proxying Web Servers" documentation (docs.posit.co).
{{/if}}

## Python frameworks

Each command runs an app file in a dedicated terminal: pass the file's URI
and Positron runs it. The URI takes the same form `vscode.open` needs -- read
[files.md]({{skill_dir}}/references/files.md) for the exact shape this
environment requires (a relative path always names the wrong file{{#if remote}},
and on this remote workspace so does a bare absolute path{{/if}}). The file does
not have to be open, and Positron leaves the user's editors as they are -- do
not open the file yourself first. All of them come from the Python extension, so
expect `not-found` if Python support isn't loaded yet. They share the same
return shape: the app's user-facing URL, or nothing -- see step 4 of "The
flow" above for what nothing means.

### `python.execDashInTerminal`

{{command:python.execDashInTerminal}}

### `python.execFastAPIInTerminal`

Opens the interactive API docs (`/docs`) in the Viewer rather than a UI page,
because a FastAPI app has no UI of its own.

{{command:python.execFastAPIInTerminal}}

### `python.execFlaskInTerminal`

{{command:python.execFlaskInTerminal}}

### `python.execGradioInTerminal`

{{command:python.execGradioInTerminal}}

### `python.execMarimoInTerminal`

Serves a marimo notebook file as an app (`marimo run --headless`), so the user
sees the app read-only rather than marimo's editable notebook. There is no
command for the editable view (`marimo edit`); say so rather than starting it
from a shell.

{{command:python.execMarimoInTerminal}}

### `python.execStreamlitInTerminal`

{{command:python.execStreamlitInTerminal}}

## Shiny (Python and R)

These come from the Shiny extension. Unlike the Python commands they run the
**active editor's** file rather than a path you pass, so open the app file with
`vscode.open` first. Read [files.md]({{skill_dir}}/references/files.md) before
calling it -- it gives the exact argument shape this environment needs (a
relative path always opens the wrong file{{#if remote}}, and on this remote
workspace so does a bare absolute path{{/if}}). If the open errors or opens the
wrong thing, fix the argument and re-open before running: the run commands act
on whatever editor is focused, so a bad open makes the run fail too.
{{#if shiny_agent_metadata}}
### `shiny.python.runApp`

Runs the active editor's file as a Shiny for Python app in a dedicated terminal
and previews it.

{{command:shiny.python.runApp}}

### `shiny.r.runApp`

Runs the active editor's file as a Shiny for R app in the R Console (R Shiny
apps run in the console, not a terminal) and previews it.

{{command:shiny.r.runApp}}

### `shiny.stopApp`

Stops the running Shiny app.

{{command:shiny.stopApp}}
{{else}}
The Shiny extension installed here publishes no command metadata, so unlike the
Python commands above these have no generated **Arguments** and **Returns**
entries; what follows is hand-written. They take no arguments.

- **`shiny.python.runApp`** -- runs the active editor's file as a Shiny for
  Python app in a dedicated terminal and previews it.
- **`shiny.r.runApp`** -- runs the active editor's file as a Shiny for R app
  in the R Console (R Shiny apps run in the console, not a terminal) and
  previews it.
- **`shiny.stopApp`** -- stops the running Shiny app.
{{/if}}

## Debugging an app

Each Python framework also has a debug variant that starts the app under the
Python debugger: `python.debugDashInTerminal`,
`python.debugFastAPIInTerminal`, `python.debugFlaskInTerminal`,
`python.debugGradioInTerminal`, `python.debugMarimoInTerminal`,
`python.debugStreamlitInTerminal` (and `shiny.python.debugApp` for Shiny for
Python). The Python debug variants take
the same optional file argument as the run commands. Use one only when the
user explicitly asks to debug their app -- the user sets breakpoints in the
editor gutter; you cannot set them. To simply run or restart an app, always
use the run commands above.
