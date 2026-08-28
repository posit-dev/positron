# Positron file commands

Opening a file in an editor. See [SKILL.md]({{skill_dir}}/SKILL.md) for how to
call these commands and how to handle failures.

The **Arguments** and **Returns** entries below are generated from the running
build's command metadata, so they always match this Positron. The surrounding
guidance is hand-written.

## Open the path, don't open a picker

When the user names a file, open that file. **Do not call a command that opens
a file picker.** `workbench.action.files.openFile`,
`workbench.action.files.openFileFolder` and `workbench.action.quickOpen` all
put a dialog or quick-pick in front of the user and wait for them to choose,
which hands the task straight back to the person who asked you to do it. None
of them are agent-compatible, and none of them appear anywhere in this skill --
if you are reaching for one, you are working from general VS Code knowledge
rather than from this file.

`vscode.open` is the only file-opening command this skill documents. If the
user has not given you a path and you cannot work one out from the workspace,
ask them which file they mean rather than opening a picker so they can browse.

## `vscode.open`

Opens a file in whichever editor Positron associates with that file type. No
precondition -- always enabled.

{{command:vscode.open}}

### Building the argument

The path must be absolute. A bare relative path is not resolved against the
workspace: it is parsed as a URI and ends up rooted at the filesystem root, so
`data.csv` becomes `/data.csv` and silently opens the wrong thing (or nothing).
Resolve it against the workspace folder yourself and pass the absolute result.

On Windows a bare drive-letter path is worse than wrong-looking -- it does not
parse as a path at all. In `C:/Users/me/data.csv` the leading `C:` is read as a
URI scheme, so pass `file:///C:/Users/me/data.csv` instead.

Never guess at a filename. If you are not sure the file exists, check first:
the command reports success either way, and a path that does not exist opens an
editor showing a file-not-found error rather than failing the call.

### Which editor a file opens in

This is the reason `vscode.open` is worth reaching for rather than reading the
file yourself -- the right editor for the file type is a Positron feature the
user may not know about.

| File | Opens in |
| --- | --- |
| `.csv`, `.tsv`, `.parquet`, `.parq`, `.xlsx` | Data Explorer |
| The `.gz` form of any of those, e.g. `data.csv.gz` | Data Explorer |
| `.ipynb` | A notebook editor |
| Anything else | A text editor |

Extensions are matched lowercase, so `DATA.CSV` gets a text editor, not the
Data Explorer. A user can also redirect any of these with the
`workbench.editorAssociations` setting, so treat the table as the default
rather than a guarantee -- say "this should open in the Data Explorer", and let
what the user sees settle it.

Opening a tabular file is also how you get a Data Explorer editor in the first
place, which the summary-panel commands in
[ui.md]({{skill_dir}}/references/ui.md) require as the active editor.

### What it does not do

- **It is not how you read a file.** The command shows the file to the user; it
  returns nothing about the contents. If you need the data, read the file
  yourself or run code in the session.
- **http and https URLs do not open an editor.** They go to the user's external
  browser. Say that is what you are about to do before doing it.
