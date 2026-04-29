/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { OpenInDataExplorerAction, type IInlineDataExplorerActionContext } from '../../../browser/notebookCells/InlineDataExplorerActions.js';

describe('OpenInDataExplorerAction', () => {
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.build();

	let executeCommand: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		executeCommand = vi.fn().mockResolvedValue(undefined);
		ctx.instantiationService.stub(ICommandService, { executeCommand });
	});

	function buildContext(overrides: Partial<IInlineDataExplorerActionContext> = {}): IInlineDataExplorerActionContext {
		return {
			documentUri: URI.parse('file:///nb.ipynb'),
			sourceLanguage: 'python',
			commId: 'comm-123',
			variablePath: ['df'],
			title: 'df',
			shape: { rows: 10, columns: 5 },
			gridInstance: undefined,
			...overrides,
		};
	}

	it('dispatches positron-data-explorer.openFromInline with documentUri', async () => {
		const action = new OpenInDataExplorerAction();
		const actionCtx = buildContext();

		await ctx.instantiationService.invokeFunction(accessor => action.run(accessor, actionCtx));

		expect(executeCommand).toHaveBeenCalledWith('positron-data-explorer.openFromInline', {
			commId: 'comm-123',
			variablePath: ['df'],
			notebookUri: actionCtx.documentUri,
		});
	});

	it('works for surfaces without notebook context (e.g. Quarto)', async () => {
		const action = new OpenInDataExplorerAction();
		const actionCtx = buildContext({
			documentUri: URI.parse('file:///doc.qmd'),
			sourceLanguage: '',
			cell: undefined,
			notebookInstance: undefined,
		});

		await ctx.instantiationService.invokeFunction(accessor => action.run(accessor, actionCtx));

		expect(executeCommand).toHaveBeenCalledWith('positron-data-explorer.openFromInline', expect.objectContaining({
			notebookUri: actionCtx.documentUri,
		}));
	});
});
