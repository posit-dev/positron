/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { TestQuickPick } from '../../../../../test/vitest/testQuickPick.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionLocation, LanguageRuntimeStartupBehavior } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { URI } from '../../../../../base/common/uri.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { INotebookKernel, INotebookKernelService } from '../../../notebook/common/notebookKernelService.js';
import { POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID } from '../../../runtimeNotebookKernel/common/runtimeNotebookKernelConfig.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../common/positronNotebookCommon.js';
import { SelectPositronNotebookKernelAction } from '../../browser/SelectPositronNotebookKernelAction.js';

function makeRuntime(overrides: Partial<ILanguageRuntimeMetadata> = {}): ILanguageRuntimeMetadata {
	const languageId = overrides.languageId ?? 'python';
	const base: ILanguageRuntimeMetadata = {
		extensionId: new ExtensionIdentifier('test-extension'),
		base64EncodedIconSvg: '',
		extraRuntimeData: { supported: true },
		runtimeId: `${languageId}-${Math.random().toString(36).slice(2)}`,
		runtimePath: '/usr/bin/test',
		runtimeVersion: '0.0.0',
		sessionLocation: LanguageRuntimeSessionLocation.Browser,
		startupBehavior: LanguageRuntimeStartupBehavior.Implicit,
		languageId,
		languageName: 'Python',
		languageVersion: '3.12.0',
		runtimeName: 'Python 3.12 (System)',
		runtimeShortName: '3.12',
		runtimeSource: 'System',
	};
	return { ...base, ...overrides };
}

describe('SelectPositronNotebookKernelAction', () => {
	const notebookUri = URI.parse('file:///test.ipynb');
	const grabFocus = vi.fn();
	const selectKernelForNotebook = vi.fn();
	const notifyError = vi.fn();
	let pick: TestQuickPick<IQuickPickItem>;

	const ctx = createTestContainer()
		.withRuntimeServices()
		.stub(IEditorService, {
			activeEditorPane: {
				getId: () => POSITRON_NOTEBOOK_EDITOR_ID,
				notebookInstance: {
					textModel: { uri: notebookUri, notebookType: 'jupyter-notebook' },
					grabFocus,
				},
			},
		})
		.stub(INotificationService, stubInterface<INotificationService>({ error: notifyError }))
		.stub(IQuickInputService, stubInterface<IQuickInputService>({
			createQuickPick: (() => pick.asQuickPick()) as IQuickInputService['createQuickPick'],
		}))
		.build();

	beforeEach(() => {
		pick = ctx.disposables.add(new TestQuickPick<IQuickPickItem>());
	});

	function registerKernel(runtime: ILanguageRuntimeMetadata): INotebookKernel {
		return stubInterface<INotebookKernel>({
			id: `${POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID}/${runtime.runtimeId}`,
		});
	}

	function stubKernelService(all: INotebookKernel[]) {
		ctx.instantiationService.stub(INotebookKernelService, {
			getMatchingKernel: () => ({ selected: undefined, suggestions: [], all, hidden: [] }),
			selectKernelForNotebook,
		});
	}

	function runAction(runtimeId?: string) {
		return ctx.instantiationService.invokeFunction(accessor =>
			new SelectPositronNotebookKernelAction().run(accessor, runtimeId));
	}

	// Agent-invocable path: a runtimeId is supplied, so the command must
	// resolve it directly and skip the picker entirely.
	it('selects the kernel for a registered runtimeId without opening a picker', async () => {
		const runtimeService = ctx.get(ILanguageRuntimeService);
		const runtime = makeRuntime({ runtimeId: 'py-1' });
		ctx.disposables.add(runtimeService.registerRuntime(runtime));
		const kernel = registerKernel(runtime);
		stubKernelService([kernel]);

		const result = await runAction('py-1');

		expect(result).toBe(true);
		expect(selectKernelForNotebook).toHaveBeenCalledWith(
			kernel,
			{ uri: notebookUri, notebookType: 'jupyter-notebook' },
		);
		expect(grabFocus).toHaveBeenCalledOnce();
	});

	// An unresolvable runtimeId must surface a clear error rather than
	// silently falling back to the interactive picker.
	it('throws and notifies without selecting a kernel for an unknown runtimeId', async () => {
		stubKernelService([]);

		await expect(runAction('does-not-exist')).rejects.toThrow(/does-not-exist/);

		expect(notifyError).toHaveBeenCalledWith(expect.stringContaining('does-not-exist'));
		expect(selectKernelForNotebook).not.toHaveBeenCalled();
		expect(grabFocus).not.toHaveBeenCalled();
	});

	// A resolvable runtimeId with no matching notebook kernel must also
	// surface a clear error: returning false would look like success to
	// validateAndExecuteCommand.
	it('throws and notifies when the runtime resolves but no notebook kernel matches', async () => {
		const runtimeService = ctx.get(ILanguageRuntimeService);
		const runtime = makeRuntime({ runtimeId: 'py-2' });
		ctx.disposables.add(runtimeService.registerRuntime(runtime));
		stubKernelService([]);

		await expect(runAction('py-2')).rejects.toThrow(/py-2/);

		expect(notifyError).toHaveBeenCalledWith(expect.stringContaining('py-2'));
		expect(selectKernelForNotebook).not.toHaveBeenCalled();
		expect(grabFocus).not.toHaveBeenCalled();
	});

	// The kernel badge submenu forwards a context object as the first
	// argument; it must be treated as "no id supplied" (picker path), not
	// as a runtime id.
	it('opens the picker when a menu context object is forwarded as the argument', async () => {
		stubKernelService([]);

		const menuContext = { instance: {} };
		const promise = runAction(menuContext as never);
		await vi.waitFor(() => expect(pick.show).toHaveBeenCalled());

		pick.cancel();

		await expect(promise).resolves.toBe(false);
		expect(notifyError).not.toHaveBeenCalled();
		expect(selectKernelForNotebook).not.toHaveBeenCalled();
	});
});
