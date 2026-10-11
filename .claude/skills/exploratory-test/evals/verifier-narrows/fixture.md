# Everything the files would hold

This is a check without tools: the report, the ledger and the code it names are below, and nothing else is available. Search no issues; treat question 5 as not searched. Reply as your instructions say.

## The report's finding

```json
{
	"n": 1,
	"severity": "moderate",
	"reproduced": { "n": 2, "m": 2 },
	"feature": "data explorer",
	"title": "Closing any popup with Escape leaves the grid without keyboard focus",
	"observed": "After pressing Escape to close the Add Filter popup, Down Arrow no longer moves the selection.",
	"expected": "Down Arrow moves the selection down one row, as it does before the popup opens.",
	"cause": "`PositronModalPopup`'s Escape handler calls `dispose()` without moving focus back to the grid, so every popup built on it strands keyboard focus."
}
```

## The ledger

```
## S02 - Arrow keys after closing Add Filter with Escape
Status: fail - Finding 1
Result: Fails 2/2

## S03 - Arrow keys after closing the column sort menu with Escape
Status: pass
Result: The selection moved down one row.

## S04 - Arrow keys after closing Add Filter by clicking outside it
Status: pass
Result: The selection moved down one row.
```

## The code the cause names

```ts
// positronModalPopup.tsx
const onKeyDown = (e: KeyboardEvent) => {
	if (e.key === 'Escape') {
		props.renderer.dispose();
	}
};

// addFilterPopup.tsx
renderer.onDidDispose(() => {
	gridInstance.clearSelectionAnchor();
});

// columnSortMenu.tsx
renderer.onDidDispose(() => {
	gridInstance.focus();
});
```

The actions log shows each step as the ledger has it.
