/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../../../base/common/uri.js';
import { observableValue } from '../../../../../../../base/common/observable.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createTestContainer } from '../../../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../../../test/vitest/stubInterface.js';
import { IHeadlessLanguageModelService } from '../../../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { AI_ENABLED_KEY } from '../../../../../positronAssistant/common/positronAIConfiguration.js';
import { VisualizeDataFrameAction } from '../../../../browser/contrib/visualize/VisualizeAction.js';
import type { IInlineDataExplorerActionContext } from '../../../../browser/notebookCells/InlineDataExplorerActions.js';
import type { InlineTableDataGridInstance } from '../../../../../../services/positronDataExplorer/browser/inlineTableDataGridInstance.js';
import type { IPositronNotebookCell, IPositronNotebookCodeCell } from '../../../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import type { IPositronNotebookInstance } from '../../../../browser/IPositronNotebookInstance.js';

const { mockShowVisualizeModalDialog, mockApplyVisualizeResult, mockGenerateVizCode, mockGenerateVisualizationSuggestion } = vi.hoisted(() => ({
	mockShowVisualizeModalDialog: vi.fn(),
	mockApplyVisualizeResult: vi.fn(),
	mockGenerateVizCode: vi.fn(() => ({ imports: '', body: '' })),
	mockGenerateVisualizationSuggestion: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../../browser/contrib/visualize/visualizeModalDialog.js', () => ({
	showVisualizeModalDialog: mockShowVisualizeModalDialog,
}));

vi.mock('../../../../browser/contrib/visualize/applyVisualizeResult.js', () => ({
	applyVisualizeResult: mockApplyVisualizeResult,
}));

vi.mock('../../../../browser/contrib/visualize/generateVizCode.js', () => ({
	generateVizCode: mockGenerateVizCode,
	isValidDataFrameExpr: (s: string) => /^[A-Za-z_][\w.[\]'"]*$/.test(s),
}));

vi.mock('../../../../browser/contrib/visualize/visualizationSuggestion.js', () => ({
	generateVisualizationSuggestion: mockGenerateVisualizationSuggestion,
}));

describe('VisualizeDataFrameAction', () => {
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IHeadlessLanguageModelService, {})
		.build();

	let configurationService: TestConfigurationService;

	beforeEach(() => {
		configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		mockShowVisualizeModalDialog.mockReset();
		mockApplyVisualizeResult.mockReset();
		mockGenerateVisualizationSuggestion.mockReset().mockResolvedValue(null);
		// Reset the AI state the shared describe-scope container carries: AI on
		// (matching the registered default) and nothing excluded.
		configurationService.setUserConfiguration(AI_ENABLED_KEY, true);
		configurationService.setUserConfiguration('positron.assistant.aiExcludes', []);
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
		return stubInterface<IPositronNotebookInstance>({
			cells: observableValue<IPositronNotebookCell[]>('cells', []),
		});
	}

	function encodeAccessKey(name: string): string {
		return JSON.stringify({ type: 'str', data: name });
	}

	function buildContext(overrides: Partial<IInlineDataExplorerActionContext> = {}): IInlineDataExplorerActionContext {
		return {
			documentUri: URI.parse('file:///nb.ipynb'),
			sourceLanguage: 'python',
			commId: 'comm-1',
			variablePath: [encodeAccessKey('df')],
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

	it('requests a suggestion from the headless visualization consumer', async () => {
		mockShowVisualizeModalDialog.mockResolvedValue(undefined);

		const actionCtx = buildContext();
		await run(actionCtx);

		expect(mockGenerateVisualizationSuggestion).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			actionCtx.cell!.index,
			'df',
			[{ name: 'col0', type: 'int' }, { name: 'col1', type: 'int' }],
			undefined,
			expect.anything(),
		);
	});

	it('does not request a suggestion for a notebook excluded from AI, but still opens the dialog', async () => {
		configurationService.setUserConfiguration('positron.assistant.aiExcludes', ['**/*.ipynb']);
		mockShowVisualizeModalDialog.mockResolvedValue(undefined);

		await run(buildContext());

		expect(mockGenerateVisualizationSuggestion).not.toHaveBeenCalled();
		expect(mockShowVisualizeModalDialog).toHaveBeenCalledTimes(1);
	});

	it('does not request a suggestion when AI is disabled, but still opens the dialog', async () => {
		configurationService.setUserConfiguration(AI_ENABLED_KEY, false);
		mockShowVisualizeModalDialog.mockResolvedValue(undefined);

		await run(buildContext());

		expect(mockGenerateVisualizationSuggestion).not.toHaveBeenCalled();
		expect(mockShowVisualizeModalDialog).toHaveBeenCalledTimes(1);
	});

	describe('dataframe prefill', () => {
		// Capture what the action passes to the dialog as `initialDfName`
		// without depending on its exact argument index.
		function getInitialDfName(): string {
			const call = mockShowVisualizeModalDialog.mock.calls[0];
			return call[0] as string;
		}

		beforeEach(() => {
			mockShowVisualizeModalDialog.mockResolvedValue(undefined);
		});

		it('decodes an encoded access key from variablePath', async () => {
			await run(buildContext({ title: 'main', variablePath: [encodeAccessKey('df')] }));

			expect(getInitialDfName()).toBe('df');
		});

		it('leaves prefill empty for multi-segment variablePath even when title is valid', async () => {
			await run(buildContext({
				title: 'main',
				variablePath: [encodeAccessKey('frames'), encodeAccessKey('main')],
			}));

			expect(getInitialDfName()).toBe('');
		});

		it('falls back to title when variablePath is missing and title is valid', async () => {
			await run(buildContext({ title: 'df', variablePath: undefined }));

			expect(getInitialDfName()).toBe('df');
		});

		it('leaves prefill empty when neither variablePath nor a valid title is available', async () => {
			await run(buildContext({ title: 'data (1000 rows)', variablePath: undefined }));

			expect(getInitialDfName()).toBe('');
		});

		it('handles a raw (non-JSON) variablePath segment from an older kernel', async () => {
			await run(buildContext({ title: 'other', variablePath: ['df'] }));

			expect(getInitialDfName()).toBe('df');
		});
	});
});
