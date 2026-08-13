## Change markers

You will see two flavors of change markers in the source code:

### Posit Workbench

Posit Workbench (PWB) change markers indicate places where Posit Workbench's VS
Code
server (vscode-server) has diverged from upstream behavior. They look like this:

```
// --- Start PWB ---
// old code
New code..
// --- End PWB ---
```

### Positron

Positron's change markers indicate places where Positron has diverged from
usptream behavior. They usually look like this:

```
// --- Start Positron ---
// old code
New code..
// --- End Positron ---
```

## Creating change markers

If you need to create Positron-specific change markers, use the format above.
Place your markers in such a way as to minimize future merge conflicts.

Positron change markers are only necessary in files that come from upstream VS
Code. Do not add change markers to files that are Positron-specific.

When adding a change marker, make sure to include a comment explaining why the
marker is necessary. Don't be too verbose, but briefly state what the upstream
behavior is, the intent of Positron's divergence, and how to resolve conflicts.
