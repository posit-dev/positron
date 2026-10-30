/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
// vs/test/vitest/** is allow-listed for test files (eslint.config.js), but the rule does not
// recognize src/vs/workbench/browser/<feature>/test/ as a test path, so it flags the import.
// eslint-disable-next-line local/code-import-patterns
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { getUniqueFolderName } from '../../utilities/folderNameUtils.js';

const PARENT = URI.file('/home/user');

/**
 * Creates a file service stub that reports the given folder names as existing in PARENT.
 * @param existing The folder names that exist.
 */
function fileServiceWith(...existing: string[]) {
	const paths = new Set(existing.map(name => URI.joinPath(PARENT, name).toString()));
	return stubInterface<IFileService>({
		exists: vi.fn(async (resource: URI) => paths.has(resource.toString())),
	});
}

describe('getUniqueFolderName', () => {
	it('returns the base name when it does not exist', async () => {
		const fileService = fileServiceWith();
		expect(await getUniqueFolderName('my-python-project', PARENT, fileService)).toBe('my-python-project');
	});

	it('appends -2 when the base name exists', async () => {
		const fileService = fileServiceWith('my-python-project');
		expect(await getUniqueFolderName('my-python-project', PARENT, fileService)).toBe('my-python-project-2');
	});

	it('increments until it finds a name that does not exist', async () => {
		const fileService = fileServiceWith('my-python-project', 'my-python-project-2', 'my-python-project-3');
		expect(await getUniqueFolderName('my-python-project', PARENT, fileService)).toBe('my-python-project-4');
	});

	it('falls back to the base name when every candidate exists', async () => {
		const fileService = stubInterface<IFileService>({ exists: vi.fn(async () => true) });
		expect(await getUniqueFolderName('my-python-project', PARENT, fileService)).toBe('my-python-project');
	});
});
