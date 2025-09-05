Goal: Add left-aligned cell-run bar per #9262.

The current cell execution info icon should be replaced with a more dynamic icon that stays the same as current when a cell is _not_ selected, but when a cell is selected or moused-over it turns into a run-cell button.

## How we will implement

- Add a new type of contribution for the cell-action items.
	- This will be a contribution for cell actions that go on the left-hand side of the cell. In this case there is only a single "main" action, (which will probably always be a run cell button).
	- When a cell has more than one left-hand action, a dropdown icon will be shown next to the main action which opens a context menu. This will be used for things like debug-cell etc..
- Add logic in the info icon to show the main action and potentially the dropdown on hover or cell-selection.
- Fix alignment so that the action-icon is aligned with the first line of code in the cell.


## Next Steps:
- Switch run cell to 'left' position
- Verify it doesn't show up in the action bar
- Add new method to get the left-hand actions from the registry
- Add logic to pull left-hand actions for the cell info icon
- Render primary left-hand-action in place of the current info icon when cell is selected or icon is hovered.
- Add logic for extra actions to show up in a dropdown menu.
- Test by adding a dummy run-cell action.
