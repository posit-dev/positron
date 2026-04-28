/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { IPositronNotebookCodeCell } from '../../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { IPositronNotebookInstance } from '../../../browser/IPositronNotebookInstance.js';
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

	it('dispatches positron-data-explorer.openFromInline with commId, variablePath, notebookUri', async () => {
		const action = new OpenInDataExplorerAction();
		const actionCtx: IInlineDataExplorerActionContext = {
			cell: stubInterface<IPositronNotebookCodeCell>({}),
			notebookInstance: stubInterface<IPositronNotebookInstance>({ uri: URI.parse('file:///nb.ipynb') }),
			commId: 'comm-123',
			variablePath: ['df'],
			title: 'df',
			shape: { rows: 10, columns: 5 },
			gridInstance: undefined,
		};

		await action.run({ get: <T,>(svc: any) => ctx.get(svc) } as any, actionCtx);

		expect(executeCommand).toHaveBeenCalledWith('positron-data-explorer.openFromInline', {
			commId: 'comm-123',
			variablePath: ['df'],
			notebookUri: actionCtx.notebookInstance.uri,
		});
	});
});
