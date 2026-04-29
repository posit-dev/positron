/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { screen } from '@testing-library/react';
import { ISize } from '../../../../../base/browser/positronReactRenderer.js';
import { ISettableObservable, observableValue } from '../../../../../base/common/observable.js';
import { assertDefined } from '../../../../../base/common/types.js';
import { IScopedContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { EnvironentProvider } from '../../browser/EnvironmentProvider.js';
import { NotebookInstanceProvider } from '../../browser/NotebookInstanceProvider.js';
import { NotebookMarkdownCell } from '../../browser/notebookCells/NotebookMarkdownCell.js';
import { IPositronNotebookMarkdownCell } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { createTestPositronNotebookInstance, TestPositronNotebookInstance } from './testPositronNotebookInstance.js';

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
vi.mock('../../browser/notebookCells/useCellContextKeys.js', () => ({
	useCellContextKeys: () => undefined,
}));
vi.mock('../../browser/notebookCells/CellContextKeyServiceProvider.js', () => ({
	CellScopedContextKeyServiceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	useCellScopedContextKeyService: () => undefined,
}));

describe('NotebookMarkdownCell', () => {
	const ctx = createTestContainer().withNotebookEditorServices().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderMarkdownCell(content: string, editorShown: boolean): { cell: IPositronNotebookMarkdownCell; notebook: TestPositronNotebookInstance } {
		const notebook = createTestPositronNotebookInstance(
			[[content, 'markdown', CellKind.Markup]],
			ctx,
		);
		const cell = notebook.cells.get()[0];
		assertDefined(cell, 'cell at index 0');
		expect(cell.isMarkdownCell()).toBe(true);
		const markdownCell = cell as IPositronNotebookMarkdownCell;
		// Concrete class uses observableValue, so the cast is safe at runtime.
		(markdownCell.editorShown as ISettableObservable<boolean>).set(editorShown, undefined);

		const environmentBundle = {
			size: observableValue<ISize>('test-size', { width: 800, height: 600 }),
			scopedContextKeyProviderCallback: () => stubInterface<IScopedContextKeyService>({}),
		};
		rtl.render(
			<NotebookInstanceProvider instance={notebook}>
				<EnvironentProvider environmentBundle={environmentBundle}>
					<NotebookMarkdownCell cell={markdownCell} />
				</EnvironentProvider>
			</NotebookInstanceProvider>
		);

		return { cell: markdownCell, notebook };
	}

	it('preview mode passes the cell content through to the Markdown renderer', () => {
		renderMarkdownCell('# Heading\n\n**Bold**', false);

		expect(mockedMarkdown).toHaveBeenCalled();
		expect(mockedMarkdown.mock.calls[0][0]).toMatchObject({ content: '# Heading\n\n**Bold**' });
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
});
