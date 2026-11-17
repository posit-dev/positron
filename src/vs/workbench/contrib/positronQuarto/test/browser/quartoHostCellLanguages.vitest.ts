/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { explainUnrunnableCell, hostCellRuntimeLanguage, hostOwnedCellLanguages } from '../../browser/quartoHostCellLanguages.js';
import { createTestRuntimeStartupService } from './quartoTestRuntimeStartupService.js';

describe('hostOwnedCellLanguages', () => {
	it('claims SQL cells only while SQL support is on, and nothing while Positron serves no cells', () => {
		expect([
			hostOwnedCellLanguages(true, true),
			hostOwnedCellLanguages(true, false),
			hostOwnedCellLanguages(false, true),
		]).toEqual([['r', 'python', 'sql', 'ggsql'], ['r', 'python'], []]);
	});
});

describe('hostCellRuntimeLanguage', () => {
	it('names the runtime a cell runs in, or nothing when Positron does not run it', () => {
		const runtimes = createTestRuntimeStartupService(['python', 'r', 'ggsql']);
		const python = { jupyterKernel: undefined, primaryLanguage: 'python' };
		const knitr = { jupyterKernel: undefined, primaryLanguage: 'r' };
		expect([
			hostCellRuntimeLanguage('sql', python, runtimes),
			hostCellRuntimeLanguage('ggsql', knitr, runtimes),
			hostCellRuntimeLanguage('sql', knitr, runtimes),
			hostCellRuntimeLanguage('mermaid', python, runtimes),
			hostCellRuntimeLanguage('python', python, runtimes),
		]).toEqual(['ggsql', 'ggsql', undefined, undefined, 'python']);
	});
});

describe('explainUnrunnableCell', () => {
	it('explains a cell that does not run, says to install ggsql when that is why, and is silent for one that runs', () => {
		const said: string[] = [];
		const notificationService = stubInterface<INotificationService>({
			info: (message: unknown) => { said.push(`info: ${message}`); return undefined!; },
			prompt: (_severity: unknown, message: string) => { said.push(`prompt: ${message}`); return undefined!; },
		});
		const services = (languages: string[]) => ({
			runtimeStartupService: createTestRuntimeStartupService(languages),
			notificationService,
			commandService: stubInterface<ICommandService>({}),
		});
		const python = { jupyterKernel: undefined, primaryLanguage: 'python' };
		const knitr = { jupyterKernel: undefined, primaryLanguage: 'r' };

		const answers = [
			explainUnrunnableCell('sql', python, services(['python', 'ggsql'])),
			explainUnrunnableCell('sql', knitr, services(['r', 'ggsql'])),
			explainUnrunnableCell('sql', python, services(['python'])),
			explainUnrunnableCell('mermaid', python, services(['python', 'ggsql'])),
		];

		expect(answers).toEqual([false, true, true, true]);
		expect(said.map(s => s.split(' ').slice(0, 3).join(' '))).toEqual([
			'info: SQL cells', 'prompt: Install the', 'info: There is',
		]);
	});
});
