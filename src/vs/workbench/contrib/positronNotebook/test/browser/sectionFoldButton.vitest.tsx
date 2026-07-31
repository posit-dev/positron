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
import { createTestPositronNotebookInstance, TestPositronNotebookInstance } from './testPositronNotebookInstance.js';

// Mocks below match notebookMarkdownCell.vitest.tsx: skip the markdown
// renderer (KaTeX AMD load), the Monaco editor widget, the action-bar, and
// the context-key chains.
vi.mock('../../browser/notebookCells/Markdown.js', () => ({
	Markdown: () => null,
}));
vi.mock('../../browser/notebookCells/CellEditorMonacoWidget.js', () => ({
	CellEditorMonacoWidget: () => null,
}));
vi.mock('../../browser/notebookCells/NotebookCellActionBar.js', () => ({
	NotebookCellActionBar: () => null,
}));
vi.mock('../../browser/notebookCells/CellProvider.js', () => ({
	CellProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	useCell: () => ({ scopedContextKeyService: undefined }),
	useCodeCell: () => { throw new Error('not a code cell'); },
}));

describe('SectionFoldButton', () => {
	const ctx = createTestContainer().withNotebookEditorServices().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderMarkdownCell(markdownSource: string): TestPositronNotebookInstance {
		// A markdown cell followed by a code cell, so a heading heads a
		// non-empty foldable section.
		const notebook = createTestPositronNotebookInstance(
			[
				[markdownSource, 'markdown', CellKind.Markup],
				['1 + 1', 'python', CellKind.Code],
			],
			ctx,
		);
		const cell = notebook.cells.get()[0];
		assertDefined(cell, 'cell at index 0');
		expect(cell).toBeInstanceOf(PositronNotebookMarkdownCell);
		// Narrowing cast: the toBeInstanceOf assertion above guarantees the
		// runtime type; the concrete class is needed to match the prop type
		// on <NotebookMarkdownCell>.
		const markdownCell = cell as unknown as PositronNotebookMarkdownCell;

		rtl.render(
			<NotebookInstanceProvider instance={notebook}>
				<NotebookMarkdownCell cell={markdownCell} />
			</NotebookInstanceProvider>
		);

		return notebook;
	}

	it('header cell shows a fold chevron that collapses and expands the section', async () => {
		const notebook = renderMarkdownCell('# Heading');
		const codeCellHandle = notebook.cells.get()[1].handle;
		const user = userEvent.setup();

		// Collapse: the cells under the header become hidden.
		const collapseButton = screen.getByRole('button', { name: 'Collapse Section' });
		expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
		await user.click(collapseButton);
		expect(notebook.sectionFolding.hiddenCellHandles.get().has(codeCellHandle)).toBe(true);

		// Expand: the same button now reads Expand Section.
		const expandButton = screen.getByRole('button', { name: 'Expand Section' });
		expect(expandButton).toHaveAttribute('aria-expanded', 'false');
		await user.click(expandButton);
		expect(notebook.sectionFolding.hiddenCellHandles.get().size).toBe(0);
	});

	it('collapsed header shows a clickable hidden-cell count hint', async () => {
		const notebook = renderMarkdownCell('# Heading');
		const user = userEvent.setup();

		await user.click(screen.getByRole('button', { name: 'Collapse Section' }));

		const hint = screen.getByRole('button', { name: '1 cell hidden' });
		await user.click(hint);
		expect(notebook.sectionFolding.hiddenCellHandles.get().size).toBe(0);
		expect(screen.queryByRole('button', { name: '1 cell hidden' })).not.toBeInTheDocument();
	});

	it('non-header markdown cell shows no fold chevron', () => {
		renderMarkdownCell('just some prose');
		expect(screen.queryByRole('button', { name: 'Collapse Section' })).not.toBeInTheDocument();
	});
});
