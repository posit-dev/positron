# Positron interactive web app commands

Running an interactive web app -- Dash, FastAPI, Flask, Gradio, marimo,
Streamlit, or Shiny -- through Positron's Develop Data Apps feature. See
[SKILL.md]({{skill_dir}}/SKILL.md) for how to call these commands and how to
handle failures.

The **Arguments** and **Returns** entries below are generated from the command
metadata this build and its installed extensions publish, so they always match
this Positron. The surrounding guidance is hand-written.

## Prefer these commands over running a server yourself

The commands below run an app the way Positron's play button does: a managed
terminal or console, automatic URL detection, any proxying the environment
requires, and a preview once the URL is found. Starting the same app with
`executeCode` or a raw terminal command (`python app.py`, `flask run`,
`shiny run`, and so on) blocks a console or leaves an orphaned server, skips
URL detection and proxying, and never reaches a preview.

Start a server yourself only when no command below covers the framework, or as
a last resort once the matching command has failed -- and tell the user that is
what you are doing and why.

**On Posit Workbench**, `localhost` URLs are not reachable from the user's
browser, and several frameworks additionally need base-path or proxy
configuration that these commands apply automatically. Running applications
manually in this environment may lead to unexpected errors. Do not respond to
an app that doesn't load there by modifying the app, changing its port, or
adding workarounds -- re-run it with the matching command below.

## Step-by-step

1. **Identify the framework** from the app file's imports (`import dash`,
   `from flask import`, `from shiny import`, `import marimo`,
   `library(shiny)`, ...). If you cannot tell which framework a file uses, ask
   the user rather than guessing.
2. **Run the matching command** from the sections below, passing the app
   file's URI. App startup can take a while, so the command may take a moment
	 to come back.
3. **Do not read the result as proof the app is up.** These commands return
   nothing, and they return nothing whether the app is serving or failed to
   start. You cannot read the app's terminal or console output either, and
   Positron may have shown the user an error notification you cannot see, so
   you have no evidence of your own about the app's state.
4. **Say what you ran and where the preview should appear, then let the user
   confirm.** Every command previews the app once Positron detects its URL --
   in the Viewer pane by default, but the user's preview mode setting can point
   it at an editor tab or their own browser instead, so name the Viewer only
   when you know that is where it went (see "Settings"). Ask the user to paste
	 the app's terminal (or console) output if nothing shows up. Do not re-run
	 the command on a hunch: re-running restarts an app that may be perfectly fine.

   Detection can also lag or lapse: a slow app can outrun the detection
   timeout the user controls with `positron.runApp.urlDetectionTimeout`, and a
   shell without shell integration disables detection entirely, so a
   terminal-run app runs with nothing ever previewing. For an app run in the
   console (Shiny for R), upon timeout  Positron notifies the
   user and keeps watching, so the app may appear in the Viewer by itself a
   little later. Re-running would only restart an app that was about to show
   up.

The Python commands run whatever file you pass without checking its framework,
so a wrong URI or a mismatched command surfaces as a startup error in the app's
terminal -- which you cannot see -- rather than as a failed call. When the user
reports that nothing appeared, ask for that output, then fix the URI or command
and re-run rather than switching to a raw terminal run. The Python commands
have no precondition, so they never come back `disabled`; a `disabled` result
from a Shiny command means the active editor's file was not recognized as a
Shiny app.

Lifecycle: re-running a command restarts the app (Positron closes the app's
old terminal first). **You cannot stop a running app yourself**: no command
here stops an app server or kills a terminal (`shiny.stopApp` for Shiny is
the one exception). When the user wants an app stopped, tell them to press
the stop button in the Viewer pane when the app was previewed there, or to
kill the app's terminal -- it is named after the framework.

## The app's URL

These commands do not return the app's URL, and you cannot read it out of the
app's terminal output, so you never have one to hand the user. Point them at
the surface the app was previewed on instead (see "Settings")
-- that is where they interact with it. Do not tell them to open a URL in order
to see their app, and never guess at a port.

**Elsewhere than Posit Workbench**, if the user specifically wants an address
for a full browser tab, the app prints one in its terminal output: ask them to
read it from there.

**On Posit Workbench** that printed `localhost` URL is not reachable from the
user's browser, so it is not the address to give them. Point them at the
Workbench extension's Proxied Servers view instead.

## Settings

You do not have to guess at any of these: read them with
`positronSettings.getConfiguredSettings`, filtered to `runApp` or `terminal`
(see the Positron settings skill). A user who has set nothing is on the
default. Each setting's own description in Positron's settings editor is the
authoritative wording; the notes here cover only what changes how you work.

### `positron.runApp.previewMode`

Where the app is previewed once its URL is detected: the Viewer pane
(`viewer`, the default), a Simple Browser editor tab (`editor`), the user's own
browser (`external`), or nowhere (`none`). It applies to the Python framework
commands; Shiny is governed separately by `shiny.previewType`.

`none` is the one that changes how you work: it turns URL detection off
entirely, so a healthy app produces no preview anywhere and waiting or
re-running will not change that. `external` matters less but still makes
"check the Viewer" the wrong thing to say. Read the setting before telling the
user which pane to look at, and after a run the user says they cannot see.

### `positron.runApp.urlDetectionTimeout`

How long Positron waits for the app to print its URL. A slow app can outrun
it: the app still runs, it just never gets previewed.

### `terminal.integrated.shellIntegration.enabled`

URL detection for terminal-run apps rides on shell integration. With it off the
app still runs, but Positron never sees its URL and nothing previews.

Neither the timeout nor shell integration is a reason to re-run. Ask the user
what the app's terminal shows instead.

## Posit Workbench

Everything in this section applies only when the session is running on Posit
Workbench. If the user asks whether their app will work there, this is the
difference to mention: on Workbench an app must be run through the commands
below to be reachable at all, and its code has to tolerate being served under
a proxy path.

### Write proxy-safe app code

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

### Recognize proxy-related failures

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

### Working on Posit Workbench

- In-session requests to `localhost` do work: you may smoke-test a running
  app with `curl http://localhost:<port>/...` from a terminal. Never pass that
  `localhost` URL on to the user -- point them at the Proxied Servers view.
- If the user insists on running from a terminal anyway, the app needs the
  same proxy-safe code as above, and it is opened from the Workbench
  extension's Proxied Servers view rather than the printed URL. See
  Workbench's "Proxying Web Servers" documentation (docs.posit.co).

## Python frameworks

Each command runs an app file in a dedicated terminal: pass the file's URI
and Positron runs it. The URI takes the same form `vscode.open` needs -- read
[files.md]({{skill_dir}}/references/files.md) for the exact shape this
environment requires (a relative path always names the wrong file). The file
does not have to be open, and Positron leaves the user's editors as they are --
do not open the file yourself first. All of them come from the Python
extension, so expect `not-found` if Python support isn't loaded yet. None of
them return the app's URL -- see steps 3 and 4 of "The flow" above for how to
tell whether the app actually started.

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
command for the editable view (`marimo edit`) -- if the user wants that, say so
and start it from a terminal.

{{command:python.execMarimoInTerminal}}

### `python.execStreamlitInTerminal`

{{command:python.execStreamlitInTerminal}}

## Shiny (Python and R)

These come from the Shiny extension. Unlike the Python commands they run the
**active editor's** file rather than a path you pass, so open the app file with
`vscode.open` first. Read [files.md]({{skill_dir}}/references/files.md) before
calling it -- it gives the exact argument shape this environment needs (a
relative path always opens the wrong file). If the open errors or opens the
wrong thing, fix the argument and re-open before running: the run commands act
on whatever editor is focused, so a bad open makes the run fail too.

The Shiny extension ships out of this repo and publishes no command metadata,
so unlike the Python commands above these have no generated **Arguments** and
**Returns** entries; what follows is hand-written. In the extension versions
this skill covers they take no arguments. A newer Shiny release may accept the
app file's URI directly; until this section documents that argument, keep
opening the file first -- a version that ignores the argument would silently run
whatever editor is focused instead.

- **`shiny.python.runApp`** -- runs the active editor's file as a Shiny for
  Python app in a dedicated terminal and previews it.
- **`shiny.r.runApp`** -- runs the active editor's file as a Shiny for R app
  in the R Console (R Shiny apps run in the console, not a terminal) and
  previews it.
- **`shiny.stopApp`** -- stops the running Shiny app.

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
