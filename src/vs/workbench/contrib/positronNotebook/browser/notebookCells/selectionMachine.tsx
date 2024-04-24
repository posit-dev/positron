/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import { IPositronNotebookCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/interfaces';
import { assign, setup } from 'xstate';

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
			| { type: 'selectCell'; cell: IPositronNotebookCell }
			| { type: 'deselectCell'; cell: IPositronNotebookCell }
	},
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
						cells: ({ context, event }) => event.cells
					})
				}
			}
		},
		'No Selection': {
			on: {
				selectCell: {
					target: 'Single Selection',
					actions: assign({
						selectedCells: ({ context, event }) => {
							return event.cell;
						},
					}),
				},
			},
		},
		'Single Selection': {
			initial: 'notEditing',
			on: {
				'arrowKeys': [
					{
						target: 'Multi Selection',
						guard: ({ event }) => event.meta,
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
						guard: ({ event }) => !event.meta,
						actions: assign({
							selectedCells: ({ context, event }) => {
								const currentSelection = context.selectedCells as SingleSelection;
								const indexOfCell = context.cells.indexOf(currentSelection);
								const indexOfNextSelection = clampIndices(context.cells, indexOfCell + (event.up ? -1 : 1));
								return context.cells[indexOfNextSelection];
							}
						})
					},
				],
				deselectCell: {
					target: 'No Selection',
					actions: assign({
						selectedCells: null,
					})
				}
			},
			states: {
				'editing': {
					on: {
						escapePress: {
							target: 'notEditing',
							actions: assign({
								selectedCells: ({ context }) => null
							}),
						},
					}
				},
				'notEditing': {
					on: {
						enterPress: {
							target: 'editing',
							actions: assign({
								editingCell: true,
							})
						},

					},
				}
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
						guard: ({ context, event }) => {
							const currentSelection = context.selectedCells as MultiSelection;
							// Are there just two cells selected? If so deselecting one
							// will lead to the single selection state
							return currentSelection.length === 2;
						},
						actions: assign({
							selectedCells: ({ context, event }) => {
								const currentSelection = context.selectedCells as MultiSelection;
								return currentSelection.filter(c => c !== event.cell)[0];
							}
						})
					},
					{
						target: 'Multi Selection',
						guard: ({ context, event }) => {
							const currentSelection = context.selectedCells as MultiSelection;
							// Are there more than two cells selected? If so deselecting one
							// will keep the multi selection state
							return currentSelection.length > 2;
						},
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
		// 'Editing Cell': {
		// 	on: {
		// 		escapePress: {
		// 			target: 'Selection',
		// 			actions: assign({
		// 				editingCell: false
		// 			}),
		// 		},
		// 	},
		// },
	},
});
