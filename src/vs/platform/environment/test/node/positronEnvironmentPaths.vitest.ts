/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { join, resolve } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import product from '../../../product/common/product.js';
import { OPTIONS, parseArgs } from '../../node/argv.js';
import { NativeEnvironmentService } from '../../node/environmentService.js';
import { getUserDataPath } from '../../node/userDataPath.js';

const productService = { _serviceBrand: undefined, ...product };

// Start every test with none of the path override variables set, whatever the
// developer's shell exports.
const overrideNames = ['EXTENSIONS', 'PORTABLE', 'APPDATA'].flatMap(name => [`POSITRON_${name}`, `VSCODE_${name}`]);

beforeEach(() => {
	for (const name of overrideNames) {
		vi.stubEnv(name, undefined);
	}
});

afterEach(() => {
	vi.unstubAllEnvs();
});

function createEnvironmentService(argv: string[] = []): NativeEnvironmentService {
	return new NativeEnvironmentService(parseArgs(argv, OPTIONS), productService);
}

describe('getUserDataPath', () => {
	const portableDir = resolve('/tmp/positron-portable');
	const appDataDir = resolve('/tmp/positron-appdata');

	test('uses POSITRON_PORTABLE', () => {
		vi.stubEnv('POSITRON_PORTABLE', portableDir);

		expect(getUserDataPath(parseArgs([], OPTIONS), product.nameShort)).toBe(join(portableDir, 'user-data'));
	});

	test('prefers POSITRON_PORTABLE over VSCODE_PORTABLE', () => {
		vi.stubEnv('POSITRON_PORTABLE', portableDir);
		vi.stubEnv('VSCODE_PORTABLE', resolve('/tmp/vscode-portable'));

		expect(getUserDataPath(parseArgs([], OPTIONS), product.nameShort)).toBe(join(portableDir, 'user-data'));
	});

	test('falls back to VSCODE_PORTABLE, which the server relies on since it never normalizes', () => {
		vi.stubEnv('VSCODE_PORTABLE', portableDir);

		expect(getUserDataPath(parseArgs([], OPTIONS), product.nameShort)).toBe(join(portableDir, 'user-data'));
	});

	test('uses POSITRON_APPDATA', () => {
		vi.stubEnv('POSITRON_APPDATA', appDataDir);

		expect(getUserDataPath(parseArgs([], OPTIONS), product.nameShort)).toBe(join(appDataDir, product.nameShort));
	});

	test('prefers POSITRON_APPDATA over VSCODE_APPDATA', () => {
		vi.stubEnv('POSITRON_APPDATA', appDataDir);
		vi.stubEnv('VSCODE_APPDATA', resolve('/tmp/vscode-appdata'));

		expect(getUserDataPath(parseArgs([], OPTIONS), product.nameShort)).toBe(join(appDataDir, product.nameShort));
	});

	test('falls back to VSCODE_APPDATA', () => {
		vi.stubEnv('VSCODE_APPDATA', appDataDir);

		expect(getUserDataPath(parseArgs([], OPTIONS), product.nameShort)).toBe(join(appDataDir, product.nameShort));
	});
});

describe('NativeEnvironmentService path overrides', () => {
	const positronExtensions = resolve('/tmp/positron-extensions');
	const vscodeExtensions = resolve('/tmp/vscode-extensions');
	const portableDir = resolve('/tmp/positron-portable');

	test('extensionsPath uses POSITRON_EXTENSIONS', () => {
		vi.stubEnv('POSITRON_EXTENSIONS', positronExtensions);

		expect(createEnvironmentService().extensionsPath).toBe(positronExtensions);
	});

	test('extensionsPath prefers POSITRON_EXTENSIONS over VSCODE_EXTENSIONS', () => {
		vi.stubEnv('POSITRON_EXTENSIONS', positronExtensions);
		vi.stubEnv('VSCODE_EXTENSIONS', vscodeExtensions);

		expect(createEnvironmentService().extensionsPath).toBe(positronExtensions);
	});

	test('extensionsPath falls back to VSCODE_EXTENSIONS', () => {
		vi.stubEnv('VSCODE_EXTENSIONS', vscodeExtensions);

		expect(createEnvironmentService().extensionsPath).toBe(vscodeExtensions);
	});

	test('--extensions-dir wins over POSITRON_EXTENSIONS', () => {
		const cliDir = resolve('/tmp/cli-extensions');
		vi.stubEnv('POSITRON_EXTENSIONS', positronExtensions);

		expect(createEnvironmentService(['--extensions-dir', cliDir]).extensionsPath).toBe(cliDir);
	});

	test('POSITRON_PORTABLE places portable data under the portable dir', () => {
		vi.stubEnv('POSITRON_PORTABLE', portableDir);
		const service = createEnvironmentService(['--__enable-file-policy']);

		expect({
			extensionsPath: service.extensionsPath,
			argvResource: service.argvResource.fsPath,
			appSharedDataHome: service.appSharedDataHome.fsPath,
			policyFile: service.policyFile?.fsPath,
		}).toEqual({
			extensionsPath: join(portableDir, 'extensions'),
			// The URI-backed paths come back through fsPath, which lowercases a Windows drive letter.
			argvResource: URI.file(join(portableDir, 'argv.json')).fsPath,
			appSharedDataHome: URI.file(join(portableDir, 'shared-data')).fsPath,
			policyFile: URI.file(join(portableDir, 'policy.json')).fsPath,
		});
	});
});
