/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { INotebookService } from '../../../../contrib/notebook/common/notebookService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { IRuntimeSessionMetadata, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ExtHostLanguageRuntimeShape, RuntimeSessionCapabilities } from '../../../common/positron/extHost.positron.protocol.js';
import { buildRuntimeOpenEventResource, ExtHostLanguageRuntimeSessionAdapter } from '../../../browser/positron/mainThreadLanguageRuntime.js';

/**
 * `pathService.fileURI()` is stubbed so these tests run on any host OS;
 * each scenario passes the URI it would have produced on the target OS.
 */

async function callHelper(opts: {
	inputPath: string;
	fileURIResult: URI;
	defaultUriScheme: string;
	remoteAuthority: string | undefined;
}): Promise<URI> {
	const pathService = stubInterface<IPathService>({
		fileURI: vi.fn().mockResolvedValue(opts.fileURIResult),
		defaultUriScheme: opts.defaultUriScheme,
	});
	const environmentService = stubInterface<IWorkbenchEnvironmentService>({
		remoteAuthority: opts.remoteAuthority,
	});
	return buildRuntimeOpenEventResource(opts.inputPath, pathService, environmentService);
}

describe('buildRuntimeOpenEventResource', () => {
	it('#13431 - Windows UNC path, desktop', async () => {
		const uri = await callHelper({
			inputPath: '\\\\NASEN1010\\share\\folder\\file.R',
			fileURIResult: URI.from({ scheme: 'file', authority: 'NASEN1010', path: '/share/folder/file.R' }),
			defaultUriScheme: 'file',
			remoteAuthority: undefined,
		});
		expect(uri.toString()).toBe('file://nasen1010/share/folder/file.R');
	});

	it('#8374 - Windows drive letter, desktop', async () => {
		const uri = await callHelper({
			inputPath: 'C:\\Users\\jenny\\foo.R',
			fileURIResult: URI.from({ scheme: 'file', authority: '', path: '/C:/Users/jenny/foo.R' }),
			defaultUriScheme: 'file',
			remoteAuthority: undefined,
		});
		expect(uri.toString()).toBe('file:///c%3A/Users/jenny/foo.R');
	});

	it('POSIX path, desktop', async () => {
		const uri = await callHelper({
			inputPath: '/Users/jenny/foo.R',
			fileURIResult: URI.from({ scheme: 'file', authority: '', path: '/Users/jenny/foo.R' }),
			defaultUriScheme: 'file',
			remoteAuthority: undefined,
		});
		expect(uri.toString()).toBe('file:///Users/jenny/foo.R');
	});

	it('#10378 - POSIX path, web build: vscode-remote scheme + remote authority populated', async () => {
		const uri = await callHelper({
			inputPath: '/home/jenny/foo.R',
			fileURIResult: URI.from({ scheme: 'file', authority: '', path: '/home/jenny/foo.R' }),
			defaultUriScheme: 'vscode-remote',
			remoteAuthority: 'localhost:8080',
		});
		expect(uri.toString()).toBe('vscode-remote://localhost:8080/home/jenny/foo.R');
	});
});

describe('ExtHostLanguageRuntimeSessionAdapter - missing-package capabilities', () => {
	const disposables = ensureNoLeakedDisposables();

	function createAdapter(capabilities: RuntimeSessionCapabilities) {
		const $getMissingPackageProbe = vi.fn().mockResolvedValue('import requests');
		const proxy = stubInterface<ExtHostLanguageRuntimeShape>({
			$getMissingPackageProbe,
			// Read by the adapter's dispose() via ensureNoLeakedDisposables.
			$disposeLanguageRuntime: vi.fn(),
		});
		const adapter = disposables.add(new ExtHostLanguageRuntimeSessionAdapter(
			{
				handle: 0,
				dynState: { inputPrompt: '>', continuationPrompt: '+', sessionName: 'test' },
				capabilities,
			},
			stubInterface<ILanguageRuntimeMetadata>({}),
			stubInterface<IRuntimeSessionMetadata>({ notebookUri: undefined }),
			stubInterface<IRuntimeSessionService>({
				onDidChangeForegroundSession: Event.None,
				onDidReceiveRuntimeEvent: Event.None,
			}),
			stubInterface<INotificationService>({}),
			new NullLogService(),
			stubInterface<ICommandService>({}),
			stubInterface<INotebookService>({}),
			stubInterface<IEditorService>({}),
			stubInterface<IPathService>({}),
			stubInterface<IWorkbenchEnvironmentService>({}),
			proxy,
			stubInterface<IOpenerService>({}),
		));
		return { adapter, $getMissingPackageProbe };
	}

	it('leaves the optional methods undefined when the extension session lacks them', () => {
		const { adapter } = createAdapter({ listMissingPackages: false, getMissingPackageProbe: false });

		expect(adapter.listMissingPackages).toBeUndefined();
		expect(adapter.getMissingPackageProbe).toBeUndefined();
	});

	it('defines the optional methods when the extension session implements them', () => {
		const { adapter } = createAdapter({ listMissingPackages: true, getMissingPackageProbe: true });

		expect(adapter.listMissingPackages).toBeDefined();
		expect(adapter.getMissingPackageProbe).toBeDefined();
	});

	it('projects the console error to name/message/traceback before crossing the RPC boundary', async () => {
		const { adapter, $getMissingPackageProbe } = createAdapter({ listMissingPackages: true, getMissingPackageProbe: true });

		// A frontend IConsoleError carries extra fields (sessionId, languageId)
		// that must not reach extensions; keep it as a variable so the extra
		// fields pass the structural check.
		const error = {
			name: 'ModuleNotFoundError',
			message: `No module named 'requests'`,
			traceback: [],
			sessionId: 's1',
			languageId: 'python',
		};

		await adapter.getMissingPackageProbe!(error, CancellationToken.None);

		expect($getMissingPackageProbe).toHaveBeenCalledWith(
			0,
			{ name: 'ModuleNotFoundError', message: `No module named 'requests'`, traceback: [] },
			CancellationToken.None,
		);
	});
});
