/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { buildRuntimeOpenEventResource } from '../../../browser/positron/mainThreadLanguageRuntime.js';

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
