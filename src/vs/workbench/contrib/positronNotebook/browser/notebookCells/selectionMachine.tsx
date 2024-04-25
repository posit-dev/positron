/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import { IPositronNotebookCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/interfaces';
import { assign, not, setup } from 'xstate';

type SingleSelection = IPositronNotebookCell;
type MultiSelection = IPositronNotebookCell[];

function clampIndices(cells: IPositronNotebookCell[], index: number) {
	return Math.max(0, Math.min(cells.length - 1, index));
}

export type SelectionState = {
	cells: IPositronNotebookCell[];
	selectedCells: SingleSelection | MultiSelection | null;
	editingCell: boolean;
};

export const selectionMachine = setup({
	types: {
		context: {} as SelectionState,
		events: {} as
			| { type: 'setCells'; cells: IPositronNotebookCell[] }
			| { type: 'escapePress' }
			| { type: 'enterPress' }
			| { type: 'arrowKeys'; up: boolean; meta: boolean }
			| { type: 'selectCell'; cell: IPositronNotebookCell; editMode: boolean }
			| { type: 'deselectCell'; cell: IPositronNotebookCell }
	},
	actions: {
		defocusEditor: ({ context }, params: unknown) => {
			const currentSelection = context.selectedCells as SingleSelection;
			currentSelection.defocusEditor();
		}
	},
	guards: {
		isMetaKey: (_, params: { meta: boolean }) => {
			return params.meta;
		},
		isNotMetaKey: (_, params: { meta: boolean }) => {
			return !params.meta;
		},
		twoItemsSelected: ({ context }, params: unknown) => {
			return Array.isArray(context.selectedCells) && context.selectedCells.length === 2;
		},
		isEditMode: (_, params: { editMode: boolean }) => {
			return params.editMode;
		},
		isNotEditMode: (_, params: { editMode: boolean }) => {
			return !params.editMode;
		}
	}
}).createMachine({
	context: { cells: [], selectedCells: null, editingCell: false },
	id: 'NotebookSelection',
	initial: 'Uninitialized',
	states: {
		Uninitialized: {
			on: {
				setCells: {
					target: 'No Selection',
					actions: assign({
						cells: ({ event }) => event.cells
					})
				}
			}
		},
		'No Selection': {
		},
		'Single Selection': {
			on: {
				arrowKeys: [
					{
						target: 'Multi Selection',
						guard: {
							type: 'isMetaKey',
							params: ({ event }) => ({ meta: event.meta })
						},
						actions: assign({
							selectedCells: ({ context, event }) => {
								const currentSelection = context.selectedCells as SingleSelection;
								const indexOfCell = context.cells.indexOf(currentSelection);
								const indexOfNextSelection = clampIndices(context.cells, indexOfCell + (event.up ? -1 : 1));
								return [currentSelection, context.cells[indexOfNextSelection]];
							}
						})
					},
					{
						target: 'Single Selection',
						guard: {
							type: 'isNotMetaKey',
							params: ({ event }) => ({ meta: event.meta })
						},
						actions: assign({
							selectedCells: ({ context, event }) => {
								const currentSelection = context.selectedCells as SingleSelection;
								const indexOfCell = context.cells.indexOf(currentSelection);
								const indexOfNextSelection = clampIndices(context.cells, indexOfCell + (event.up ? -1 : 1));
								const nextSelection = context.cells[indexOfNextSelection];
								nextSelection.focus();
								return nextSelection;
							}
						})
					},
				],
				deselectCell: {
					target: 'No Selection',
					actions: assign({
						selectedCells: null,
					})
				},
				enterPress: {
					target: 'Editing Selection',
					actions: assign({
						editingCell: ({ context }) => {
							const currentSelection = context.selectedCells as SingleSelection;
							// Use timeout so that enter key press is not propagated to the editor
							setTimeout(() => currentSelection.focusEditor(), 0);
							return true;
						},
					})
				},
			}
		},
		'Editing Selection': {
			on: {
				escapePress: {
					target: 'Single Selection',
					actions: [
						'defocusEditor',
						assign({
							editingCell: false,
						})],
				},
			}
		},
		'Multi Selection': {
			on: {
				escapePress: {
					target: 'Single Selection',
					actions: assign({
						selectedCells: ({ context }) => {
							const currentSelection = context.selectedCells as MultiSelection;
							return currentSelection.at(-1) as SingleSelection;
						}
					})
				},
				arrowKeys: {
					target: 'Single Selection',
					actions: assign({
						selectedCells: ({ context, event }) => {
							const currentSelection = context.selectedCells as MultiSelection;
							return (event.up ? currentSelection.at(0) : currentSelection.at(-1)) as SingleSelection;
						}
					})
				},
				deselectCell: [
					{
						target: 'Single Selection',
						guard: 'twoItemsSelected',
						actions: assign({
							selectedCells: ({ context, event }) => {
								const currentSelection = context.selectedCells as MultiSelection;
								return currentSelection.filter(c => c !== event.cell)[0];
							}
						})
					},
					{
						target: 'Multi Selection',
						guard: not('twoItemsSelected'),
						actions: assign({
							selectedCells: ({ context, event }) => {
								const currentSelection = context.selectedCells as MultiSelection;
								return currentSelection.filter(c => c !== event.cell);
							}
						})
					}
				]
			},
		},
	},
	on: {
		selectCell: [
			{
				target: '.Single Selection',
				guard: {
					type: 'isNotEditMode',
					params: ({ event }) => ({ editMode: event.editMode })
				},
				actions: assign({
					selectedCells: ({ event }) => {
						return event.cell;
					},
					editingCell: false
				}),
			},
			{
				target: '.Editing Selection',
				guard: {
					type: 'isEditMode',
					params: ({ event }) => ({ editMode: event.editMode })
				},
				actions: assign({
					selectedCells: ({ context, event }) => {
						return event.cell;
					},
					editingCell: true
				}),
			}
		],
	},
});
