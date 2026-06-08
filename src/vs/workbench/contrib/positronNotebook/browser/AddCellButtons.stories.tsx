/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { AddCodeCellButton, AddMarkdownCellButton } from './AddCellButtons.js';
import { withNotebookInstance, withPositronServices } from '../../../../../../.storybook/decorators/index.js';
import type { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { constObservable } from '../../../../base/common/observable.js';
import { Event } from '../../../../base/common/event.js';

/** Minimal mock for stories that pass the instance as a prop. */
const mockInstance = {
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
	addCell: () => { },
	selectionStateMachine: {
		selectedCells: constObservable([]),
		selectCell: () => { },
		deselectCell: () => { },
		clearSelection: () => { },
	},
} as unknown as IPositronNotebookInstance;

const meta = {
	title: 'Notebook/AddCellButtons',
	decorators: [withPositronServices, withNotebookInstance],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const CodeButton: Story = {
	render: () => <AddCodeCellButton notebookInstance={mockInstance} index={0} bordered />,
};

export const MarkdownButton: Story = {
	render: () => <AddMarkdownCellButton notebookInstance={mockInstance} index={0} bordered />,
};

export const BothButtons: Story = {
	render: () => (
		<div style={{ display: 'flex', gap: '8px' }}>
			<AddCodeCellButton notebookInstance={mockInstance} index={0} bordered />
			<AddMarkdownCellButton notebookInstance={mockInstance} index={1} bordered />
		</div>
	),
};
