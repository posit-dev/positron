/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { EnvironmentVariableMutatorType, IEnvironmentVariableMutator } from '../../../../../platform/terminal/common/environmentVariable.js';
import { IWorkspace, IWorkspaceContextService, IWorkspaceFolder } from '../../../../../platform/workspace/common/workspace.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IEnvironmentVariableCollectionWithPersistence, IEnvironmentVariableService } from '../../../../contrib/terminal/common/environmentVariable.js';
import { AbstractVariableResolverService } from '../../../../services/configurationResolver/common/variableResolver.js';
import { MainThreadEnvironment } from '../../../browser/positron/mainThreadEnvironment.js';

const folder = stubInterface<IWorkspaceFolder>({ uri: URI.file('/project'), name: 'project', index: 0 });

/** Resolves variables as the workbench does, for a workspace with `folder` open. */
class TestConfigurationResolverService extends AbstractVariableResolverService {
	constructor() {
		super({
			getFolderUri: () => folder.uri,
			getWorkspaceFolderCount: () => 1,
			getConfigurationValue: () => undefined,
			getAppRoot: () => undefined,
			getExecPath: () => undefined,
			getFilePath: () => undefined,
			getSelectedText: () => undefined,
			getLineNumber: () => undefined,
			getColumnNumber: () => undefined,
			getExtension: async () => undefined,
		});
	}
}

function mutator(variable: string, type: EnvironmentVariableMutatorType, value: string, extra: Partial<IEnvironmentVariableMutator> = {}): [string, IEnvironmentVariableMutator] {
	const key = extra.scope ? `${variable}:::${extra.scope.workspaceFolder!.uri.toString()}` : variable;
	return [key, { variable, type, value, ...extra }];
}

const collections = new Map<string, IEnvironmentVariableCollectionWithPersistence>([
	['ext.a', {
		persistent: true,
		map: new Map([
			mutator('PATH', EnvironmentVariableMutatorType.Prepend, '/a/bin:'),
			mutator('FOO', EnvironmentVariableMutatorType.Replace, 'a', { options: { applyAtProcessCreation: false, applyAtShellIntegration: true } }),
			mutator('HOME_BIN', EnvironmentVariableMutatorType.Replace, '${env:HOME}/bin'),
			mutator('PROJECT', EnvironmentVariableMutatorType.Replace, '${workspaceFolder}'),
		]),
	}],
	['ext.b', {
		persistent: false,
		map: new Map([
			mutator('PATH', EnvironmentVariableMutatorType.Prepend, '/b/bin:'),
			mutator('FOO', EnvironmentVariableMutatorType.Replace, 'b'),
			mutator('BAR', EnvironmentVariableMutatorType.Append, ':x', { scope: { workspaceFolder: folder } }),
		]),
	}],
]);

function resolve(workspaceFolder?: URI, excludeExtensions: string[] = []) {
	const mainThread = new MainThreadEnvironment(
		undefined!,
		stubInterface<IEnvironmentVariableService>({ collections }),
		stubInterface<IWorkspaceContextService>({ getWorkspace: () => stubInterface<IWorkspace>({ folders: [folder] }) }),
		new TestConfigurationResolverService(),
	);
	return mainThread.$resolveEnvironmentContributions({ PATH: '/usr/bin', HOME: '/home/me', BAR: 'bar' }, workspaceFolder, excludeExtensions);
}

describe('MainThreadEnvironment.$resolveEnvironmentContributions', () => {
	it('applies contributions as terminals do, including shell integration ones, for the workspace folder', async () => {
		expect(await resolve(folder.uri)).toEqual({
			PATH: '/a/bin:/b/bin:/usr/bin',
			HOME: '/home/me',
			// ext.a's Replace takes precedence, and applies without shell integration.
			FOO: 'a',
			BAR: 'bar:x',
			HOME_BIN: '/home/me/bin',
			PROJECT: '/project',
		});
	});

	it('applies only global contributions without an open workspace folder', async () => {
		for (const workspaceFolder of [undefined, URI.file('/elsewhere')]) {
			expect(await resolve(workspaceFolder)).toMatchObject({ BAR: 'bar', PROJECT: '${workspaceFolder}' });
		}
	});

	it('leaves out excluded extensions', async () => {
		expect(await resolve(folder.uri, ['EXT.A'])).toEqual({ PATH: '/b/bin:/usr/bin', HOME: '/home/me', FOO: 'b', BAR: 'bar:x' });
	});
});
