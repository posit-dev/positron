/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { assertDefined } from '../../../../../base/common/types.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { NotebookInstanceProvider } from '../../browser/NotebookInstanceProvider.js';
import { NotebookMarkdownCell } from '../../browser/notebookCells/NotebookMarkdownCell.js';
import { PositronNotebookMarkdownCell } from '../../browser/PositronNotebookCells/PositronNotebookMarkdownCell.js';
import { createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';

// Module mocks must be hoisted above the source imports they intercept.
const { mockedMarkdown, mockedCellEditorMonacoWidget } = vi.hoisted(() => ({
	mockedMarkdown: vi.fn(() => null),
	mockedCellEditorMonacoWidget: vi.fn(() => null),
}));

// Replace the Markdown renderer to capture the content prop without invoking
// renderNotebookMarkdown (which loads KaTeX via importAMDNodeModule async).
// Markdown rendering correctness is covered by markdownRenderer.vitest.tsx.
vi.mock('../../browser/notebookCells/Markdown.js', () => ({
	Markdown: mockedMarkdown,
}));
// Replace the Monaco editor widget so edit mode renders a lightweight stub.
vi.mock('../../browser/notebookCells/CellEditorMonacoWidget.js', () => ({
	CellEditorMonacoWidget: mockedCellEditorMonacoWidget,
}));
// Mocks below match notebookCellWrapper.vitest.tsx's NotebookCellWrapper
// strategy: skip the action-bar and context-key chains.
vi.mock('../../browser/notebookCells/NotebookCellActionBar.js', () => ({
	NotebookCellActionBar: () => null,
}));
vi.mock('../../browser/notebookCells/CellProvider.js', () => ({
	CellProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	useCell: () => ({ scopedContextKeyService: undefined }),
	useCodeCell: () => { throw new Error('not a code cell'); },
}));

describe('NotebookMarkdownCell', () => {
	const ctx = createTestContainer().withNotebookEditorServices().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderMarkdownCell(content: string, editorShown: boolean): PositronNotebookMarkdownCell {
		const notebook = createTestPositronNotebookInstance(
			[[content, 'markdown', CellKind.Markup]],
			ctx,
		);
		const cell = notebook.cells.get()[0];
		assertDefined(cell, 'cell at index 0');
		expect(cell).toBeInstanceOf(PositronNotebookMarkdownCell);
		// Narrowing cast: the toBeInstanceOf assertion above guarantees the
		// runtime type. The interface getter (isMarkdownCell()) only narrows
		// to IPositronNotebookMarkdownCell, but the concrete class is needed
		// to match the prop type on <NotebookMarkdownCell>.
		const markdownCell = cell as unknown as PositronNotebookMarkdownCell;
		markdownCell.editorShown.set(editorShown, undefined);

		rtl.render(
			<NotebookInstanceProvider instance={notebook}>
				<NotebookMarkdownCell cell={markdownCell} />
			</NotebookInstanceProvider>
		);

		return markdownCell;
	}

	it('preview mode passes the cell content through to the Markdown renderer', () => {
		renderMarkdownCell('# Heading\n\n**Bold**', false);

		// React passes `undefined` as the second arg to plain function components;
		// expect.anything() does not match undefined, so spell it out.
		expect(mockedMarkdown).toHaveBeenCalledWith(
			expect.objectContaining({ content: '# Heading\n\n**Bold**' }),
			undefined,
		);
		expect(mockedCellEditorMonacoWidget).not.toHaveBeenCalled();
	});

	it('empty markdown cell renders the placeholder instead of the Markdown renderer', () => {
		renderMarkdownCell('', false);

		expect(screen.getByText(/Empty markdown cell/)).toBeInTheDocument();
		expect(mockedMarkdown).not.toHaveBeenCalled();
	});

	it('edit mode renders the editor widget and not the Markdown renderer', () => {
		renderMarkdownCell('# Heading', true);

		expect(mockedCellEditorMonacoWidget).toHaveBeenCalled();
		expect(mockedMarkdown).not.toHaveBeenCalled();
	});

	it('double-clicking the rendered markdown section calls cell.toggleEditor()', async () => {
		const cell = renderMarkdownCell('# Heading', false);
		const toggleEditorSpy = vi.spyOn(cell, 'toggleEditor').mockResolvedValue(undefined);

		const user = userEvent.setup();
		await user.dblClick(screen.getByRole('region', { name: 'Rendered markdown content' }));

		expect(toggleEditorSpy).toHaveBeenCalledTimes(1);
	});
});
