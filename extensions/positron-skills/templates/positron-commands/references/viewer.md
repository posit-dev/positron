# Positron Viewer commands

Showing HTML files and web pages in Positron's Viewer pane. See [SKILL.md]({{skill_dir}}/SKILL.md)
for how to call these commands and how to handle failures.

The **Arguments** and **Returns** entries below are generated from the command
metadata this build and its installed extensions publish, so they always match
this Positron. The surrounding guidance is hand-written.

## Showing HTML you wrote

The Viewer shows files, not HTML strings. To show the user a page, chart,
report, or prototype you have written as HTML:

1. **Write the HTML to a file.** Put it in the workspace when the user may want
   to keep it; otherwise use a temporary directory. Give it an `.html`
   extension.
2. **Call `positronProxy.showHtmlPreview`** with the file's absolute path or
   `file://` URI.

The file's directory is served along with it, so relative links to stylesheets,
scripts, and images next to the file load. Scripts run. Re-running the command
after editing the file reloads it.

This is for static files only. To preview a web app that needs a running server
(Shiny, Dash, Flask, Streamlit, and so on), read
[interactive-apps.md]({{skill_dir}}/references/interactive-apps.md) instead.

## `positronProxy.showHtmlPreview`

Shows a local HTML file in the Viewer pane, replacing whatever the Viewer was
showing. No precondition -- always enabled.

{{command:positronProxy.showHtmlPreview}}

### Building the argument

Pass an absolute path or a `file://` URI. A relative path is not resolved
against the workspace and names the wrong file.

The command fails with an `error` when the file does not exist. Write the file
before calling it, and never guess at a filename.

It does not report what the user sees. Say that the file should now be showing
in the Viewer, and let the user tell you if it is not.

## `workbench.action.positronPreview.openUrl`

Opens an `http` or `https` URL in the Viewer pane, replacing whatever the
Viewer was showing. No precondition -- always enabled.

{{command:workbench.action.positronPreview.openUrl}}

Always pass the URL. Without it, the command asks the user to type one, which
hands the task back to them. A URL without a scheme gets `http://`; any scheme
other than `http` or `https` fails with an `error`. `localhost` URLs work even
when Positron is running remotely.

Use this for a server that is already running, such as one the user started or
documentation served locally. To start and preview a web app, use the commands
in [interactive-apps.md]({{skill_dir}}/references/interactive-apps.md) instead.
For a local file, use `positronProxy.showHtmlPreview`; this command rejects
`file://` URLs.

Many public websites refuse to be shown inside another page, so the Viewer may
stay blank for them. If the user reports that, suggest opening the page in
their browser instead.
