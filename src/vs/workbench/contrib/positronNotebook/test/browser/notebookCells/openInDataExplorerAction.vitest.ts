/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../../base/common/uri.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { JsonRpcErrorCode } from '../../../../../services/languageRuntime/common/positronBaseComm.js';
import { IPositronDataExplorerInstance } from '../../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { IPositronDataExplorerService } from '../../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { INotebookLanguageRuntimeSession, IRuntimeSessionService } from '../../../../../services/runtimeSession/common/runtimeSessionService.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { OpenInDataExplorerAction, type IInlineDataExplorerActionContext } from '../../../browser/notebookCells/InlineDataExplorerActions.js';

describe('OpenInDataExplorerAction', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();

	let getInstance: ReturnType<typeof vi.fn>;
	let getInstanceForVariablePath: ReturnType<typeof vi.fn>;
	let getNotebookSessionForNotebookUri: ReturnType<typeof vi.fn>;
	let warn: ReturnType<typeof vi.fn>;
	let trace: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		getInstance = vi.fn();
		getInstanceForVariablePath = vi.fn();
		getNotebookSessionForNotebookUri = vi.fn();
		warn = vi.fn();
		trace = vi.fn();
		ctx.instantiationService.stub(IPositronDataExplorerService, { getInstance, getInstanceForVariablePath });
		ctx.instantiationService.stub(IRuntimeSessionService, { getNotebookSessionForNotebookUri });
		ctx.instantiationService.stub(INotificationService, { warn });
		ctx.instantiationService.stub(ILogService, { trace });
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

	function makeInstance(openDataExplorer: () => Promise<void> = () => Promise.resolve()): IPositronDataExplorerInstance {
		return stubInterface<IPositronDataExplorerInstance>({
			dataExplorerClientInstance: stubInterface<IPositronDataExplorerInstance['dataExplorerClientInstance']>({
				openDataExplorer,
			}),
		});
	}

	async function runAction(actionCtx: IInlineDataExplorerActionContext) {
		const action = new OpenInDataExplorerAction();
		await ctx.instantiationService.invokeFunction(accessor => action.run(accessor, actionCtx));
	}

	it('focuses an existing variable-path explorer when one is registered for the session', async () => {
		const requestFocus = vi.fn();
		const existing = stubInterface<IPositronDataExplorerInstance>({ requestFocus });
		const openDataExplorer = vi.fn().mockResolvedValue(undefined);
		getInstance.mockReturnValue(makeInstance(openDataExplorer));
		getInstanceForVariablePath.mockImplementation((sessionId, path) =>
			sessionId === 'session-1' && path[0] === 'df' ? existing : undefined);
		getNotebookSessionForNotebookUri.mockReturnValue(stubInterface<INotebookLanguageRuntimeSession>({ sessionId: 'session-1' }));

		await runAction(buildContext());

		expect(requestFocus).toHaveBeenCalledTimes(1);
		expect(openDataExplorer).not.toHaveBeenCalled();
	});

	it('opens a new explorer when no existing variable-path match is found', async () => {
		const openDataExplorer = vi.fn().mockResolvedValue(undefined);
		getInstance.mockReturnValue(makeInstance(openDataExplorer));
		getNotebookSessionForNotebookUri.mockReturnValue(stubInterface<INotebookLanguageRuntimeSession>({ sessionId: 'session-1' }));

		await runAction(buildContext());

		expect(openDataExplorer).toHaveBeenCalledTimes(1);
	});

	it('falls through to comm lookup when the surface has no notebook session (e.g. Quarto)', async () => {
		const openDataExplorer = vi.fn().mockResolvedValue(undefined);
		getInstance.mockReturnValue(makeInstance(openDataExplorer));

		await runAction(buildContext({ documentUri: URI.parse('file:///doc.qmd'), sourceLanguage: '' }));

		expect(openDataExplorer).toHaveBeenCalledTimes(1);
	});

	it('warns when the inline comm instance cannot be found', async () => {
		await runAction(buildContext({ variablePath: undefined }));

		expect(warn).toHaveBeenCalledWith(expect.stringContaining('re-run the cell'));
	});

	it('warns "not supported" on MethodNotFound errors from the kernel', async () => {
		getInstance.mockReturnValue(makeInstance(() => Promise.reject({ code: JsonRpcErrorCode.MethodNotFound })));

		await runAction(buildContext({ variablePath: undefined }));

		expect(warn).toHaveBeenCalledWith(expect.stringContaining('not supported'));
	});

	it('logs (does not warn) on other errors -- benign comm-disposed race', async () => {
		getInstance.mockReturnValue(makeInstance(() => Promise.reject(new Error('boom'))));

		await runAction(buildContext({ variablePath: undefined }));

		expect(trace).toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});
});
