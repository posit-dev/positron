/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { LookupHelpTopic } from '../../browser/positronHelpActions.js';
import { IPositronHelpService } from '../../browser/positronHelpService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';

/** A session whose runtime reports the given language. */
function sessionFor(languageId: string): ILanguageRuntimeSession {
	return stubInterface<ILanguageRuntimeSession>({
		runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ languageId }),
	});
}

describe('LookupHelpTopic', () => {
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.build();

	let showHelpTopic: ReturnType<typeof vi.fn<IPositronHelpService['showHelpTopic']>>;
	let input: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<string | undefined>>>;
	let info: ReturnType<typeof vi.fn<INotificationService['info']>>;
	let warn: ReturnType<typeof vi.fn<INotificationService['warn']>>;

	/**
	 * Wires the services `run()` reads. Sessions are passed explicitly so that
	 * "no foreground session" cannot be confused with "not specified".
	 */
	function stubServices(
		foregroundSession: ILanguageRuntimeSession | undefined,
		activeSessions: ILanguageRuntimeSession[],
	): void {
		ctx.instantiationService.stub(IPositronHelpService, stubInterface<IPositronHelpService>({
			showHelpTopic,
		}));
		ctx.instantiationService.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
			foregroundSession,
			activeSessions,
		}));
		ctx.instantiationService.stub(IQuickInputService, stubInterface<IQuickInputService>({
			input: (...args: unknown[]) => input(...args),
		}));
		ctx.instantiationService.stub(INotificationService, stubInterface<INotificationService>({
			info,
			warn,
		}));
		// No editor open, so the language comes from the foreground session.
		ctx.instantiationService.stub(IEditorService, stubInterface<IEditorService>({
			activeTextEditorControl: undefined,
		}));
	}

	beforeEach(() => {
		showHelpTopic = vi.fn<IPositronHelpService['showHelpTopic']>().mockResolvedValue(true);
		input = vi.fn<(...args: unknown[]) => Promise<string | undefined>>().mockResolvedValue(undefined);
		info = vi.fn<INotificationService['info']>();
		warn = vi.fn<INotificationService['warn']>();
		const rSession = sessionFor('r');
		stubServices(rSession, [rSession]);
	});

	async function run(topicArg?: unknown) {
		const action = new LookupHelpTopic();
		return ctx.instantiationService.invokeFunction(accessor =>
			action.run(accessor, topicArg as string | undefined));
	}

	it('shows a supplied topic without prompting and reports what it looked up', async () => {
		const result = await run('mean');

		expect(result).toEqual({ found: true, topic: 'mean', languageId: 'r' });
		expect(showHelpTopic).toHaveBeenCalledWith('r', 'mean');
		expect(input).not.toHaveBeenCalled();
	});

	it('trims a supplied topic', async () => {
		const result = await run('  mean  ');

		expect(result).toEqual({ found: true, topic: 'mean', languageId: 'r' });
		expect(showHelpTopic).toHaveBeenCalledWith('r', 'mean');
	});

	it('reports not found when the topic has no help', async () => {
		showHelpTopic.mockResolvedValue(false);

		const result = await run('abcd');

		expect(result).toEqual({
			found: false,
			message: `No help found for 'abcd'.`,
		});
		expect(info).toHaveBeenCalledWith(`No help found for 'abcd'.`);
	});

	it('reports a lookup error instead of throwing', async () => {
		showHelpTopic.mockRejectedValue(Object.assign(new Error('boom'), { code: 'EFAIL' }));

		const result = await run('mean');

		expect(result).toEqual({
			found: false,
			message: `Error finding help on 'mean': boom (EFAIL).`,
		});
		expect(warn).toHaveBeenCalledWith(`Error finding help on 'mean': boom (EFAIL).`);
	});

	it('reports when no interpreter is running', async () => {
		stubServices(undefined, []);

		const result = await run('mean');

		expect(result).toEqual({
			found: false,
			message: 'There are no interpreters running. Start an interpreter to look up help topics.',
		});
		expect(showHelpTopic).not.toHaveBeenCalled();
	});

	it('reports when no session matches the resolved language', async () => {
		stubServices(sessionFor('r'), [sessionFor('python')]);

		const result = await run('mean');

		expect(result).toEqual({
			found: false,
			message: 'Open a file for the language you want to look up help topics for, or start an interpreter for that language.',
		});
		expect(showHelpTopic).not.toHaveBeenCalled();
	});

	it('prompts for a topic when none is supplied', async () => {
		input.mockResolvedValue('mean');

		const result = await run(undefined);

		expect(result).toEqual({ found: true, topic: 'mean', languageId: 'r' });
		expect(input).toHaveBeenCalled();
	});

	it('reports when the prompt is dismissed without a topic', async () => {
		input.mockResolvedValue(undefined);

		const result = await run(undefined);

		expect(result).toEqual({ found: false, message: 'No topic was provided.' });
		expect(showHelpTopic).not.toHaveBeenCalled();
	});
});
