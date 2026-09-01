/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as path from 'path';
import { UNIFIED_DOWNLOAD_URL_KEY, UNIFIED_DOWNLOAD_URL_SECTION } from './open-remote-ssh/src/serverDownloadUrl';

/**
 * `serverDownloadUrl.ts` exists once per remote extension, because each extension compiles
 * under its own tsconfig and cannot import from another extension or from `src/vs`. The
 * copies have to stay in step: correcting the resolution order in one of them and
 * forgetting the others would leave two remotes honoring the wrong setting.
 *
 * Only the open-remote-ssh copy has behavioral tests, in `serverDownloadUrl.vitest.ts`.
 * This guard is what lets those tests speak for all three.
 */
const COPIES = [
	{
		file: 'open-remote-ssh/src/serverDownloadUrl.ts',
		settingKey: 'remoteSSH.serverDownloadUrlTemplate'
	},
	{
		file: 'open-remote-wsl/src/serverDownloadUrl.ts',
		settingKey: 'remote.WSL.serverDownloadUrlTemplate'
	},
	{
		file: 'positron-dev-containers/src/server/serverDownloadUrl.ts',
		settingKey: 'dev.containers.serverDownloadUrlTemplate'
	},
] as const;

// `__dirname` is this file's own directory, so the paths hold wherever Vitest is started
// from. `process.cwd()` does not: Vitest resolves `root` for module resolution but never
// changes the working directory. `import.meta.url` would read better still, but it does not
// survive the CommonJS type check in vitest.tsconfig.json.
function read(relativePath: string): string {
	return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

/**
 * Reads one copy and masks the only thing that legitimately differs between them: the doc
 * comments naming that extension's own deprecated setting.
 */
function readNormalized(copy: typeof COPIES[number]): string {
	return read(copy.file).replaceAll(copy.settingKey, '<deprecated setting>');
}

describe('serverDownloadUrl copies', () => {
	const [ssh, wsl, devContainers] = COPIES;

	it('keeps the WSL copy in step with the SSH copy', () => {
		expect(readNormalized(wsl)).toBe(readNormalized(ssh));
	});

	it('keeps the Dev Containers copy in step with the SSH copy', () => {
		expect(readNormalized(devContainers)).toBe(readNormalized(ssh));
	});
});

/**
 * The extensions cannot import from `src/vs`, so they spell the unified setting's section and
 * key out again rather than using the exported constant. Nothing else connects the two: rename
 * the setting in core and the workbench still compiles, the copies above still match, and all
 * three extensions quietly read a key that no longer exists, sending every configured URL to
 * the product.json fallback instead.
 */
describe('the unified setting key', () => {
	it('matches the key that core registers', () => {
		const core = read('../src/vs/workbench/contrib/remote/common/positronRemoteConfiguration.ts');
		const registered = /REMOTE_SERVER_DOWNLOAD_URL_TEMPLATE_KEY = '([^']+)'/.exec(core)?.[1];

		expect(`${UNIFIED_DOWNLOAD_URL_SECTION}.${UNIFIED_DOWNLOAD_URL_KEY}`).toBe(registered);
	});
});

