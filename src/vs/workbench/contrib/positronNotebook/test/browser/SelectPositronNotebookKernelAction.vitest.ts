/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
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
		.build();

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
	it('notifies and returns false for an unknown runtimeId', async () => {
		stubKernelService([]);

		const result = await runAction('does-not-exist');

		expect(result).toBe(false);
		expect(notifyError).toHaveBeenCalledWith(expect.stringContaining('does-not-exist'));
		expect(selectKernelForNotebook).not.toHaveBeenCalled();
		expect(grabFocus).not.toHaveBeenCalled();
	});
});
