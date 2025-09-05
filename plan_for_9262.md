Goal: Add left-aligned cell-run bar per #9262.

The current cell execution info icon should be replaced with a more dynamic icon that stays the same as current when a cell is _not_ selected, but when a cell is selected or moused-over it turns into a run-cell button.

## How we will implement

- Add a new type of contribution for the cell-action items.
	- This will be a contribution for cell actions that go on the left-hand side of the cell. In this case there is only a single "main" action, (which will probably always be a run cell button).
	- When a cell has more than one left-hand action, a dropdown icon will be shown next to the main action which opens a context menu. This will be used for things like debug-cell etc..
- Add logic in the info icon to show the main action and potentially the dropdown on hover or cell-selection.
- Fix alignment so that the action-icon is aligned with the first line of code in the cell.


## Next Steps:
- [x] Switch run cell to 'left' position
- [x] Verify it doesn't show up in the action bar
- [x] Add new method to get the left-hand actions from the registry
- [x] Use CellActionButton component in the cell action bar as well.
- [x] Add logic to pull left-hand actions from registry into the cell info icon component.
- [x] Render primary left-hand-action in place of the current info icon when icon is hovered.
- [x] Add observable value to `IPositronNotebookCell` that indicates whether the cell is selected.
- [ ] Hook up cell selected observable to the info icon component to control if the primary left-hand-action is shown for selection.
- [ ] Cleanup the hover styles for run cell button.
- [x] Utilize the isSelected variable in other locations to clean up code.
- [ ] Add logic for extra actions to show up in a dropdown menu.

- Test by adding a dummy run-cell action.
