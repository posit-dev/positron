/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { EnvironmentVariableMutatorType, IEnvironmentVariableMutator } from '../../../../../platform/terminal/common/environmentVariable.js';
import { MergedEnvironmentVariableCollection } from '../../../../../platform/terminal/common/environmentVariableCollection.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IEnvironmentVariableCollectionWithPersistence, IEnvironmentVariableService } from '../../../../contrib/terminal/common/environmentVariable.js';
import { MainThreadEnvironment } from '../../../browser/positron/mainThreadEnvironment.js';

const folder = { uri: URI.file('/project'), name: 'project', index: 0 };

function mutator(variable: string, type: EnvironmentVariableMutatorType, value: string, extra: Partial<IEnvironmentVariableMutator> = {}): [string, IEnvironmentVariableMutator] {
	const key = extra.scope ? `${variable}:::${extra.scope.workspaceFolder!.uri.toString()}` : variable;
	return [key, { variable, type, value, ...extra }];
}

function contributions(collections: Map<string, IEnvironmentVariableCollectionWithPersistence>) {
	const service = stubInterface<IEnvironmentVariableService>({
		collections,
		mergedCollection: new MergedEnvironmentVariableCollection(collections),
	});
	return new MainThreadEnvironment(undefined!, service).$getEnvironmentVariableContributions();
}

describe('MainThreadEnvironment.$getEnvironmentVariableContributions', () => {
	it('reports every contribution with its details, applied ones first in application order', async () => {
		const collections = new Map<string, IEnvironmentVariableCollectionWithPersistence>([
			['ext.a', {
				persistent: true,
				map: new Map([
					mutator('PATH', EnvironmentVariableMutatorType.Prepend, '/a/bin:'),
					mutator('FOO', EnvironmentVariableMutatorType.Replace, 'a', { options: { applyAtProcessCreation: false, applyAtShellIntegration: true } }),
				]),
				descriptionMap: new Map([['', { description: 'Adds A' }]]),
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

		const result = await contributions(collections);
		expect(result.map(c => ({ ext: c.extensionId, variable: c.variable, value: c.value, applied: c.applied }))).toEqual([
			{ ext: 'ext.b', variable: 'PATH', value: '/b/bin:', applied: true },
			{ ext: 'ext.a', variable: 'PATH', value: '/a/bin:', applied: true },
			{ ext: 'ext.a', variable: 'FOO', value: 'a', applied: true },
			{ ext: 'ext.b', variable: 'BAR', value: ':x', applied: true },
			// ext.a's Replace of FOO takes precedence.
			{ ext: 'ext.b', variable: 'FOO', value: 'b', applied: false },
		]);
		expect(result[2]).toMatchObject({
			type: EnvironmentVariableMutatorType.Replace,
			applyAtProcessCreation: false,
			applyAtShellIntegration: true,
			workspaceFolder: undefined,
			description: 'Adds A',
			persistent: true,
		});
		expect(result[3]).toMatchObject({ workspaceFolder: folder, description: undefined, persistent: false, applyAtProcessCreation: true });
	});
});
