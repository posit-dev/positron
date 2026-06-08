/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import type { Decorator } from '@storybook/react';
import { Event } from '../../src/vs/base/common/event.js';
import { constObservable } from '../../src/vs/base/common/observable.js';
import { NotebookInstanceContext } from '../../src/vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider.js';
import type { IPositronNotebookInstance } from '../../src/vs/workbench/contrib/positronNotebook/browser/IPositronNotebookInstance.js';

/** Static mock notebook instance with no-op observables. */
const mockNotebookInstance = {
	cells: constObservable([]),
	kernelStatus: constObservable('idle'),
	kernel: constObservable(undefined),
	runtimeSession: constObservable(undefined),
	container: constObservable(undefined),
	isDisposed: false,
	isReadOnly: false,
	connectedToEditor: true,
	onDidScrollCellsContainer: Event.None,
	hoverManager: undefined,
	selectionStateMachine: {
		selectedCells: constObservable([]),
		selectCell: () => { },
		deselectCell: () => { },
		clearSelection: () => { },
	},
} as unknown as IPositronNotebookInstance;

/**
 * Storybook decorator providing a mock notebook instance context.
 * Use for components that call `useNotebookInstance()`.
 *
 * Chain with `withPositronServices` when both contexts are needed:
 * ```tsx
 * decorators: [withPositronServices, withNotebookInstance],
 * ```
 */
export const withNotebookInstance: Decorator = (Story) => (
	<NotebookInstanceContext.Provider value={mockNotebookInstance}>
		<Story />
	</NotebookInstanceContext.Provider>
);
