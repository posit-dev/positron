/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ListPackageDocs, ReadHelpTopic, ReadVignette } from '../../browser/positronHelpActions.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';

type CallMethod = (method: string, ...args: unknown[]) => Promise<unknown>;

/** A session whose runtime reports the given language and answers calls with `callMethod`. */
function sessionFor(languageId: string, callMethod: CallMethod): ILanguageRuntimeSession {
	return stubInterface<ILanguageRuntimeSession>({
		runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ languageId }),
		callMethod,
	});
}

const page = { help_text: '# mean', topic: 'mean', package: 'base' };

describe('ReadHelpTopic', () => {
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.build();

	let rCall: ReturnType<typeof vi.fn<CallMethod>>;
	let pythonCall: ReturnType<typeof vi.fn<CallMethod>>;

	function stubSessions(
		foregroundSession: ILanguageRuntimeSession | undefined,
		activeSessions: ILanguageRuntimeSession[],
	): void {
		ctx.instantiationService.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
			foregroundSession,
			activeSessions,
		}));
	}

	beforeEach(() => {
		rCall = vi.fn<CallMethod>().mockResolvedValue(page);
		pythonCall = vi.fn<CallMethod>().mockResolvedValue(page);
		const rSession = sessionFor('r', rCall);
		stubSessions(rSession, [rSession, sessionFor('python', pythonCall)]);
	});

	async function run(...args: unknown[]) {
		const action = new ReadHelpTopic();
		return ctx.instantiationService.invokeFunction(accessor =>
			action.run(accessor, ...(args as [string?, string?, string?])));
	}

	it('reads a topic from the foreground session', async () => {
		const result = await run(' mean ');

		expect(result).toEqual({ found: true, languageId: 'r', topic: 'mean', package: 'base', content: '# mean' });
		expect(rCall).toHaveBeenCalledWith('get_help_page', 'mean', '');
	});

	it('reads a topic from a session for the requested language and package', async () => {
		await run('read_csv', 'python', 'pandas');

		expect(pythonCall).toHaveBeenCalledWith('get_help_page', 'read_csv', 'pandas');
		expect(rCall).not.toHaveBeenCalled();
	});

	it('relays the message when the runtime finds no help page', async () => {
		rCall.mockResolvedValue('No help page found for topic abcd.');

		const result = await run('abcd');

		expect(result).toEqual({ found: false, languageId: 'r', message: 'No help page found for topic abcd.' });
	});

	it('reports a lookup error instead of throwing', async () => {
		rCall.mockRejectedValue(new Error('boom'));

		const result = await run('mean');

		expect(result).toEqual({ found: false, languageId: 'r', message: 'Error reading help: boom' });
	});

	it('reports when no topic is supplied', async () => {
		const result = await run('  ');

		expect(result).toEqual({ found: false, message: 'No help topic provided.' });
		expect(rCall).not.toHaveBeenCalled();
	});

	it('reports when no session matches the language', async () => {
		const result = await run('mean', 'julia');

		expect(result).toEqual({ found: false, languageId: 'julia', message: 'No running julia interpreter session to read help from.' });
	});

	it('reports when no interpreter is running', async () => {
		stubSessions(undefined, []);

		const result = await run('mean');

		expect(result).toEqual({ found: false, languageId: undefined, message: 'No interpreter session is running.' });
	});
});

describe('ListPackageDocs', () => {
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.build();

	let rCall: ReturnType<typeof vi.fn<CallMethod>>;

	beforeEach(() => {
		rCall = vi.fn<CallMethod>();
		const rSession = sessionFor('r', rCall);
		ctx.instantiationService.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
			foregroundSession: rSession,
			activeSessions: [rSession],
		}));
	});

	async function run(packageArg?: string) {
		return ctx.instantiationService.invokeFunction(accessor => new ListPackageDocs().run(accessor, packageArg));
	}

	it('lists the topics and vignettes of a package', async () => {
		const topics = [{ topic: 'across', title: 'Apply a function across columns', aliases: 'across, if_any' }];
		const vignettes = [{ name: 'colwise', title: 'Column-wise operations' }];
		rCall.mockResolvedValue({ package: 'dplyr', topics, vignettes });

		const result = await run('dplyr');

		expect(result).toEqual({ found: true, languageId: 'r', package: 'dplyr', topics, vignettes });
		expect(rCall).toHaveBeenCalledWith('list_package_docs', 'dplyr');
	});

	it('treats null lists from the runtime as empty', async () => {
		rCall.mockResolvedValue({ package: 'tools', topics: null, vignettes: null });

		const result = await run('tools');

		expect(result).toEqual({ found: true, languageId: 'r', package: 'tools', topics: [], vignettes: [] });
	});

	it('relays the message when the package is not installed', async () => {
		rCall.mockResolvedValue('Package nope is not installed.');

		const result = await run('nope');

		expect(result).toEqual({ found: false, languageId: 'r', message: 'Package nope is not installed.' });
	});

	it('reports when no package is supplied', async () => {
		const result = await run(undefined);

		expect(result).toEqual({ found: false, message: 'No package provided.' });
		expect(rCall).not.toHaveBeenCalled();
	});
});

describe('ReadVignette', () => {
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.build();

	let rCall: ReturnType<typeof vi.fn<CallMethod>>;

	beforeEach(() => {
		rCall = vi.fn<CallMethod>();
		const rSession = sessionFor('r', rCall);
		ctx.instantiationService.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
			foregroundSession: rSession,
			activeSessions: [rSession],
		}));
	});

	async function run(packageArg?: string, vignetteArg?: string) {
		return ctx.instantiationService.invokeFunction(accessor => new ReadVignette().run(accessor, packageArg, vignetteArg));
	}

	it('reads a vignette', async () => {
		rCall.mockResolvedValue({ content: '# Column-wise operations', title: 'Column-wise operations', name: 'colwise', package: 'dplyr' });

		const result = await run('dplyr', 'colwise');

		expect(result).toEqual({
			found: true,
			languageId: 'r',
			package: 'dplyr',
			vignette: 'colwise',
			title: 'Column-wise operations',
			content: '# Column-wise operations',
		});
		expect(rCall).toHaveBeenCalledWith('get_package_vignette', 'dplyr', 'colwise');
	});

	it('relays the message when the vignette is not found', async () => {
		rCall.mockResolvedValue('No vignette nope found for package dplyr. Available vignettes: colwise.');

		const result = await run('dplyr', 'nope');

		expect(result).toEqual({ found: false, languageId: 'r', message: 'No vignette nope found for package dplyr. Available vignettes: colwise.' });
	});

	it('reports when the vignette name is missing', async () => {
		const result = await run('dplyr', ' ');

		expect(result).toEqual({ found: false, message: 'Both a package and a vignette name are required.' });
		expect(rCall).not.toHaveBeenCalled();
	});
});
