/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ISize } from '../../../../../base/browser/positronReactRenderer.js';
import { IScopedContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { CellContextKeys } from '../../common/cellContextKeys.js';
import { NotebookContextKeys } from '../../common/notebookContextKeys.js';
import { NotebookInstanceProvider } from '../../browser/NotebookInstanceProvider.js';
import { EnvironentProvider } from '../../browser/EnvironmentProvider.js';
import { NotebookCodeCell } from '../../browser/notebookCells/NotebookCodeCell.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { CopyOutputAction } from '../../browser/positronNotebook.contribution.js';
import { createTestPositronNotebookInstance, TestCellInput } from './testPositronNotebookInstance.js';
import { CellSelectionType } from '../../browser/selectionMachine.js';
import { PositronNotebookCodeCell } from '../../browser/PositronNotebookCells/PositronNotebookCodeCell.js';

// Mock heavy transitive deps that are irrelevant to output focus testing.
vi.mock('../../browser/notebookCells/NotebookCellActionBar.js', () => ({
	NotebookCellActionBar: () => null,
}));
vi.mock('../../browser/notebookCells/CellProvider.js', () => ({
	CellProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	useCell: () => ({ scopedContextKeyService: undefined }),
	useCodeCell: () => { throw new Error('not a code cell'); },
}));
vi.mock('../../browser/notebookCells/CellEditorMonacoWidget.js', () => ({
	CellEditorMonacoWidget: () => <div data-testid='mock-editor' />,
}));
vi.mock('../../browser/notebookCells/CellLeftActionMenu.js', () => ({
	CellLeftActionMenu: () => null,
}));
vi.mock('../../browser/notebookCells/CodeCellStatusFooter.js', () => ({
	CodeCellStatusFooter: () => null,
}));

function pngOutputItem() {
	return { mime: 'image/png', data: VSBuffer.fromString('iVBORw0KGgo=') };
}

describe('Notebook output focus state', () => {
	const ctx = createTestContainer()
		.withNotebookEditorServices()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderCellWithOutput(cellInputs?: TestCellInput[]) {
		const defaultInput: TestCellInput[] = cellInputs ?? [{
			source: 'plot()',
			language: 'python',
			mime: undefined,
			cellKind: CellKind.Code,
			outputs: [{ outputId: 'output-1', outputs: [pngOutputItem()] }],
		}];
		const notebook = createTestPositronNotebookInstance(defaultInput, ctx);
		const cells = notebook.cells.get();
		notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);

		const environmentBundle = {
			size: observableValue<ISize>('test-size', { width: 800, height: 600 }),
			scopedContextKeyProviderCallback: () => stubInterface<IScopedContextKeyService>({}),
		};

		rtl.render(
			<NotebookInstanceProvider instance={notebook}>
				<EnvironentProvider environmentBundle={environmentBundle}>
					{cells.map(cell =>
						<NotebookCodeCell key={cell.handle} cell={cell as unknown as PositronNotebookCodeCell} />
					)}
				</EnvironentProvider>
			</NotebookInstanceProvider>
		);

		return { cells, notebook };
	}

	describe('CellContextKeys.outputFocused context key', () => {
		it('is defined with key positronNotebookOutputFocused', () => {
			expect(CellContextKeys.outputFocused).toBeDefined();
			expect(CellContextKeys.outputFocused.key).toBe('positronNotebookOutputFocused');
		});

		it('can be bound and set on a scoped context key service', () => {
			const { notebook } = renderCellWithOutput();

			const cellElement = document.createElement('div');
			const cellContextKeyService = notebook.scopedContextKeyService.createScoped(cellElement);
			ctx.disposables.add(cellContextKeyService);

			expect(cellContextKeyService.getContextKeyValue(CellContextKeys.outputFocused.key)).toBe(false);

			const outputFocused = CellContextKeys.outputFocused.bindTo(cellContextKeyService);
			outputFocused.set(true);
			expect(cellContextKeyService.getContextKeyValue(CellContextKeys.outputFocused.key)).toBe(true);

			outputFocused.set(false);
			expect(cellContextKeyService.getContextKeyValue(CellContextKeys.outputFocused.key)).toBe(false);
		});
	});

	describe('Output section DOM', () => {
		it('output section has tabIndex={0} making it focusable via Tab/click', () => {
			renderCellWithOutput();

			const outputSection = screen.getByTestId('cell-output');
			expect(outputSection).toHaveAttribute('tabindex', '0');
		});

		it('output section can receive focus', () => {
			renderCellWithOutput();

			const outputSection = screen.getByTestId('cell-output');
			outputSection.focus();
			expect(outputSection).toHaveFocus();
		});

		it('output section has accessible label', () => {
			renderCellWithOutput();

			const outputSection = screen.getByTestId('cell-output');
			expect(outputSection).toHaveAttribute('aria-label', 'Cell output');
		});
	});

	describe('Output focus sets context key', () => {
		it('sets positronNotebookOutputFocused to true when output section receives focus', () => {
			const { cells } = renderCellWithOutput();
			const contextKeyService = cells[0].scopedContextKeyService!;

			const outputSection = screen.getByTestId('cell-output');
			outputSection.focus();

			expect(contextKeyService.getContextKeyValue(CellContextKeys.outputFocused.key)).toBe(true);
		});

		it('sets positronNotebookOutputFocused to false when output section loses focus', () => {
			const { cells } = renderCellWithOutput();
			const contextKeyService = cells[0].scopedContextKeyService!;

			const outputSection = screen.getByTestId('cell-output');
			outputSection.focus();
			expect(contextKeyService.getContextKeyValue(CellContextKeys.outputFocused.key)).toBe(true);

			outputSection.blur();
			expect(contextKeyService.getContextKeyValue(CellContextKeys.outputFocused.key)).toBe(false);
		});

		it('keeps positronNotebookOutputFocused true when focus moves to a child element', () => {
			const { cells } = renderCellWithOutput();
			const contextKeyService = cells[0].scopedContextKeyService!;

			const outputSection = screen.getByTestId('cell-output');
			outputSection.focus();
			expect(contextKeyService.getContextKeyValue(CellContextKeys.outputFocused.key)).toBe(true);

			// Directly fire blur with relatedTarget inside the output section to
			// isolate the guard logic (avoid relying on re-focus bubbling).
			const child = document.createElement('button');
			outputSection.appendChild(child);
			fireEvent.blur(outputSection, { relatedTarget: child });

			expect(contextKeyService.getContextKeyValue(CellContextKeys.outputFocused.key)).toBe(true);
		});
	});

	describe('Focus preservation across cells', () => {
		it('focusing second cell output makes it active without losing focus', () => {
			const { cells: notebookCells } = renderCellWithOutput([
				{
					source: 'plot1()',
					language: 'python',
					mime: undefined,
					cellKind: CellKind.Code,
					outputs: [{ outputId: 'output-1', outputs: [pngOutputItem()] }],
				},
				{
					source: 'plot2()',
					language: 'python',
					mime: undefined,
					cellKind: CellKind.Code,
					outputs: [{ outputId: 'output-2', outputs: [pngOutputItem()] }],
				},
			]);

			const outputSections = screen.getAllByTestId('cell-output');
			outputSections[1].focus();

			expect(outputSections[1]).toHaveFocus();
			expect(notebookCells[1].isActive.get()).toBe(true);
		});
	});

	describe('CopyOutputAction keybinding', () => {
		it('declares Cmd+C keybinding when output is focused and cell has outputs', () => {
			const action = new CopyOutputAction();

			const keybinding = action.desc.keybinding;
			if (!keybinding || Array.isArray(keybinding)) {
				throw new Error('Expected CopyOutputAction to declare a single keybinding');
			}

			expect(keybinding.primary).toBe(KeyMod.CtrlCmd | KeyCode.KeyC);

			const whenClause = keybinding.when;
			expect(whenClause).toBeDefined();
			expect(whenClause?.serialize()).toContain(NotebookContextKeys.editorFocused.key);
			expect(whenClause?.serialize()).toContain(CellContextKeys.outputFocused.key);
			expect(whenClause?.serialize()).toContain(CellContextKeys.hasOutputs.key);
			expect(whenClause?.serialize()).toContain(`!${CellContextKeys.outputIsCollapsed.key}`);
		});

		it('has the correct action ID', () => {
			const action = new CopyOutputAction();
			expect(action.desc.id).toBe('positronNotebook.cell.copyOutput');
		});
	});

	describe('CopyOutputAction behavior', () => {
		function setupCopyAction(cellInputs: TestCellInput[]) {
			const notebook = createTestPositronNotebookInstance(cellInputs, ctx);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);

			const writeText = vi.fn();
			const accessor = stubInterface<ServicesAccessor>({
				get: (id: unknown) => {
					if (id === IClipboardService) {
						return { writeText };
					}
					return {};
				},
			});

			// Focus a non-editable element so editable/selection guards don't trigger
			const outputDiv = document.createElement('div');
			document.body.appendChild(outputDiv);
			outputDiv.tabIndex = 0;
			outputDiv.focus();

			return { notebook, accessor, writeText, cleanup: () => document.body.removeChild(outputDiv) };
		}

		it('writes empty string to clipboard when text outputs have empty content', async () => {
			const { notebook, accessor, writeText, cleanup } = setupCopyAction([{
				source: 'print("")',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [{
					outputId: 'empty-output',
					outputs: [{ mime: 'application/vnd.code.notebook.stdout', data: VSBuffer.fromString('') }],
				}],
			}]);

			const action = new CopyOutputAction();
			await action.runNotebookAction(notebook, accessor);

			expect(writeText).toHaveBeenCalledWith('');
			cleanup();
		});

		it('copies formatted JSON when cell has a single JSON output', async () => {
			const jsonData = { key: 'value', nested: { n: 42 } };
			const { notebook, accessor, writeText, cleanup } = setupCopyAction([{
				source: 'data',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [{
					outputId: 'json-output',
					outputs: [{ mime: 'application/json', data: VSBuffer.fromString(JSON.stringify(jsonData)) }],
				}],
			}]);

			const action = new CopyOutputAction();
			await action.runNotebookAction(notebook, accessor);

			expect(writeText).toHaveBeenCalledWith(JSON.stringify(jsonData, null, 2));
			cleanup();
		});
	});
});
