# Brief

Checkout: a Positron checkout, built at the head of the branch under test.

The change: in the Data Explorer, the Add Filter popup now closes by itself when the grid scrolls.

# Where the run is

You have finished exploring. Your ledger has these scenarios:

```
## S02 - Arrow keys after closing Add Filter with Escape
Status: fail - Finding 1
Result: Fails 2/2

Steps:
1. Open `flights.csv` in the Data Explorer.
2. Click a cell in the `dep_delay` column.
3. Click Add Filter.
4. Press Escape.
5. Press Down Arrow.
6. VERIFY the selection moves down one row -> FAIL - Finding 1
   Observed: The selection stays on the same cell, and further arrow presses do nothing.

## S03 - Arrow keys after closing the column sort menu with Escape
Status: pass
Result: The selection moved down one row.

## S04 - Arrow keys after closing Add Filter by clicking outside it
Status: pass
Result: The selection moved down one row.
```

Reading the code, you found that the Add Filter popup and the column sort menu both extend `PositronModalPopup`, and its Escape handler calls `dispose()` without moving focus back to the grid. The Add Filter popup also registers its own `onDidDispose` listener that the sort menu does not.

# What to do now

This is a writing check: you have no tools in this session. Write Finding 1's `title`, `observed`, `expected` and `cause`, as the report would have them, and nothing else. Then stop.
