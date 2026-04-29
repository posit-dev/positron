/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../../../platform/commands/common/commands.js';
import { createTestContainer } from '../../../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../../../test/vitest/stubInterface.js';
import { VisualizeDataFrameAction } from '../../../../browser/contrib/visualize/VisualizeAction.js';
import type { IInlineDataExplorerActionContext } from '../../../../browser/notebookCells/InlineDataExplorerActions.js';
import type { InlineTableDataGridInstance } from '../../../../../../services/positronDataExplorer/browser/inlineTableDataGridInstance.js';
import type { IPositronNotebookCodeCell } from '../../../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import type { IPositronNotebookInstance } from '../../../../browser/IPositronNotebookInstance.js';

const { mockShowVisualizeModalDialog, mockApplyVisualizeResult, mockGenerateVizCode } = vi.hoisted(() => ({
	mockShowVisualizeModalDialog: vi.fn(),
	mockApplyVisualizeResult: vi.fn(),
	mockGenerateVizCode: vi.fn(() => ({ imports: '', body: '' })),
}));

vi.mock('../../../../browser/contrib/visualize/visualizeModalDialog.js', () => ({
	showVisualizeModalDialog: mockShowVisualizeModalDialog,
	validateVisualizationSuggestion: (v: unknown) => v,
}));

vi.mock('../../../../browser/contrib/visualize/applyVisualizeResult.js', () => ({
	applyVisualizeResult: mockApplyVisualizeResult,
}));

vi.mock('../../../../browser/contrib/visualize/generateVizCode.js', () => ({
	generateVizCode: mockGenerateVizCode,
	isValidDataFrameExpr: (s: string) => /^[A-Za-z_][\w.[\]'"]*$/.test(s),
}));

describe('VisualizeDataFrameAction', () => {
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.build();

	let executeCommand: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		executeCommand = vi.fn().mockResolvedValue(null);
		ctx.instantiationService.stub(ICommandService, { executeCommand });
		mockShowVisualizeModalDialog.mockReset();
		mockApplyVisualizeResult.mockReset();
	});

	function fakeGrid(): InlineTableDataGridInstance {
		// VisualizeAction only reads .name and .description off each column;
		// stubInterface narrows the column shape to those two fields.
		const fakeColumn = (i: number) => stubInterface<NonNullable<ReturnType<InlineTableDataGridInstance['column']>>>({
			name: `col${i}`,
			description: 'int',
		});
		return stubInterface<InlineTableDataGridInstance>({
			columns: 2,
			column: fakeColumn,
		});
	}

	function fakeCell(): IPositronNotebookCodeCell {
		return stubInterface<IPositronNotebookCodeCell>({ index: 3 });
	}

	function fakeNotebook(): IPositronNotebookInstance {
		return stubInterface<IPositronNotebookInstance>({});
	}

	function buildContext(overrides: Partial<IInlineDataExplorerActionContext> = {}): IInlineDataExplorerActionContext {
		return {
			documentUri: URI.parse('file:///nb.ipynb'),
			sourceLanguage: 'python',
			commId: 'comm-1',
			variablePath: ['df'],
			title: 'df',
			shape: { rows: 10, columns: 2 },
			gridInstance: fakeGrid(),
			cell: fakeCell(),
			notebookInstance: fakeNotebook(),
			...overrides,
		};
	}

	async function run(actionCtx: IInlineDataExplorerActionContext): Promise<void> {
		const action = new VisualizeDataFrameAction();
		await ctx.instantiationService.invokeFunction(accessor => action.run(accessor, actionCtx));
	}

	it('returns without opening the dialog when source language is not python', async () => {
		await run(buildContext({ sourceLanguage: 'r' }));

		expect(mockShowVisualizeModalDialog).not.toHaveBeenCalled();
		expect(mockApplyVisualizeResult).not.toHaveBeenCalled();
	});

	it('returns when there is no grid instance', async () => {
		await run(buildContext({ gridInstance: undefined }));

		expect(mockShowVisualizeModalDialog).not.toHaveBeenCalled();
	});

	it('returns when called from a non-notebook surface (no cell or notebookInstance)', async () => {
		await run(buildContext({ cell: undefined, notebookInstance: undefined }));

		expect(mockShowVisualizeModalDialog).not.toHaveBeenCalled();
	});

	it('applies the visualize result when the dialog returns a selection', async () => {
		mockShowVisualizeModalDialog.mockResolvedValue({
			answers: { library: 'plotly', chartType: 'bar', xCol: 'col0', yCol: 'col1', dfName: 'df' },
			mode: 'newCell',
		});

		await run(buildContext());

		expect(mockShowVisualizeModalDialog).toHaveBeenCalledTimes(1);
		expect(mockApplyVisualizeResult).toHaveBeenCalledTimes(1);
		expect(mockApplyVisualizeResult).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			'newCell',
		);
	});

	it('does not apply the visualize result when the dialog is cancelled', async () => {
		mockShowVisualizeModalDialog.mockResolvedValue(undefined);

		await run(buildContext());

		expect(mockShowVisualizeModalDialog).toHaveBeenCalledTimes(1);
		expect(mockApplyVisualizeResult).not.toHaveBeenCalled();
	});

	it('forwards the suggestion request to positron-assistant.suggestVisualization', async () => {
		mockShowVisualizeModalDialog.mockResolvedValue(undefined);

		const actionCtx = buildContext();
		await run(actionCtx);

		expect(executeCommand).toHaveBeenCalledWith(
			'positron-assistant.suggestVisualization',
			actionCtx.documentUri.toString(),
			actionCtx.cell!.index,
			'df',
			[{ name: 'col0', type: 'int' }, { name: 'col1', type: 'int' }],
			expect.anything(),
		);
	});
});
