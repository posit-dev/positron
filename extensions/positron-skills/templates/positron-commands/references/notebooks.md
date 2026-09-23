# Positron notebook commands

Creating a Jupyter notebook, and reading, editing, and running its cells,
through the Positron notebook editor rather than the filesystem. See
[SKILL.md]({{skill_dir}}/SKILL.md) for how to call these commands and how to
handle failures.

The **Arguments** and **Returns** entries below are generated from the running
build's command metadata, so they always match this Positron. The surrounding
guidance is hand-written.

## Notebooks only, and only through the Positron notebook editor

These commands operate on `.ipynb` files open in the Positron notebook editor,
not on notebook content in general. A `.ipynb` open in the built-in (Jupyter)
notebook editor instead is not reachable this way -- there is no command here
to switch editors for the user; report that instead of guessing at a
workaround. For anything that is not a Jupyter notebook (`.qmd`, `.Rmd`, plain
text), use the file tools instead of these commands.

## Targeting a notebook

Every command but `create` takes an optional `path`. Omit it to target the
active notebook editor (falling back to one that is open but not focused, if
nothing is active); pass the `path` you gave `create`, or any path already
open in a Positron notebook editor, to target a specific one instead. A call
that finds no matching notebook returns `ok: false` with an explanatory
`error`, never a thrown failure.

## Creating a notebook

### `positronNotebook.create`

Creates a new, empty `.ipynb` file with the given kernel language and opens it
in the Positron notebook editor. Use `positronNotebook.insertCell` afterward to
add cells -- this command only creates the file.

{{command:positronNotebook.create}}

## Reading cells

### `positronNotebook.getCells`

Reads a notebook's cells: index, type, content, and execution status for each.
Pass `cellIndices` to read specific cells rather than the whole notebook. Set
`includeOutputs` to also get each code cell's **text** outputs -- this omits
images; use `positronNotebook.runCells` on an already-run cell to get its image
outputs.

{{command:positronNotebook.getCells}}

## Editing cells

### `positronNotebook.insertCell`

Inserts a new cell. Omit `index` to append at the end. Set `run: true` on a
code cell to run it immediately and get its outputs back in the same call
(text and images) -- this is `insertCell` followed by `runCells` in one step,
so prefer it over two separate calls when you know the cell should run.

{{command:positronNotebook.insertCell}}

### `positronNotebook.updateCellContent`

Replaces a cell's content in place, keeping its type and everything else about
it (outputs, metadata) unchanged. Does not run the cell -- follow with
`positronNotebook.runCells` if the user wants the new content executed.

{{command:positronNotebook.updateCellContent}}

### `positronNotebook.deleteCells`

Deletes one or more cells by index. Indices refer to the notebook's current
state before any of the deletions in this call, not to positions after earlier
ones have shifted things -- pass them all in one call rather than deleting one
at a time from a stale index list.

{{command:positronNotebook.deleteCells}}

## Running cells

### `positronNotebook.runCells`

Runs one or more cells and returns each one's outputs (text and images, SVGs
rasterized to PNG). The run is visible in the notebook, same as if the user had
run it themselves.

{{command:positronNotebook.runCells}}
