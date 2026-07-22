/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Event } from '../../../../../base/common/event.js';
import { createModelServices } from '../../../../../editor/test/common/testTextModel.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import type { IInputBoundary } from '../../../../../editor/common/languages.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { TestLanguageRuntimeSession } from '../../../runtimeSession/test/common/testLanguageRuntimeSession.js';
import { PositronConsoleInstance } from '../../browser/positronConsoleService.js';
import { RuntimeItemPendingInput } from '../../browser/classes/runtimeItemPendingInput.js';
import { CodeSubmissionResult, IConsoleFindWidget, IConsoleFindWidgetFactory, SessionAttachMode } from '../../browser/interfaces/positronConsoleService.js';
import { ConsoleErrorFollowupService, IConsoleErrorFollowupService } from '../../common/consoleErrorFollowup.js';
import { CodeAttributionSource } from '../../common/positronConsoleCodeExecution.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeState, RUNTIME_CODE_INCOMPLETE_ERROR } from '../../../languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionMetadata } from '../../../runtimeSession/common/runtimeSessionService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';

/** A no-op find widget so the instance's constructor can create one. */
class TestConsoleFindWidgetFactory implements IConsoleFindWidgetFactory {
	declare readonly _serviceBrand: undefined;
	createFindWidget(): IConsoleFindWidget {
		return {
			reveal() { },
			hide() { },
			find() { },
			refreshSearch() { },
			layout() { },
			getDomNode() { return document.createElement('div'); },
			onDidHide: Event.None,
			dispose() { },
		};
	}
}

const TestRuntimeMetadata: ILanguageRuntimeMetadata = {
	base64EncodedIconSvg: '',
	extensionId: new ExtensionIdentifier('test.extension'),
	extraRuntimeData: {},
	languageId: 'r',
	runtimeId: 'test.runtime',
	runtimeName: 'Test R',
	languageName: 'R',
	languageVersion: '4.3.0',
	runtimePath: '/path/to/runtime',
	runtimeShortName: 'R',
	runtimeSource: 'test',
	runtimeVersion: '1.0.0',
	sessionLocation: LanguageRuntimeSessionLocation.Machine,
	startupBehavior: LanguageRuntimeStartupBehavior.Explicit
};

function createSessionMetadata(sessionId: string): IRuntimeSessionMetadata {
	return {
		sessionId,
		createdTimestamp: Date.now(),
		sessionMode: LanguageRuntimeSessionMode.Console,
		notebookUri: undefined,
		startReason: 'Unit Test'
	};
}

describe('PositronConsoleInstance.submitCode', () => {
	const disposables = new DisposableStore();

	afterEach(() => {
		disposables.clear();
	});

	function createInstance(): {
		instance: PositronConsoleInstance;
		languageFeaturesService: ILanguageFeaturesService;
		session: TestLanguageRuntimeSession;
	} {
		const instantiationService = createModelServices(disposables, [
			[IConsoleFindWidgetFactory, TestConsoleFindWidgetFactory],
			[IConsoleErrorFollowupService, ConsoleErrorFollowupService],
		]);
		const languageService = instantiationService.get(ILanguageService);
		const languageFeaturesService = instantiationService.get(ILanguageFeaturesService);
		// The model service is created lazily; force it so the instance can use it.
		instantiationService.get(IModelService);
		disposables.add(languageService.registerLanguage({ id: 'r' }));

		// Give the instance a real scrollback budget so transcript items (the
		// pending-input preview, the submitting placeholder) are not trimmed away
		// the moment another item is added. The constructor reads this value.
		const configurationService = instantiationService.get(IConfigurationService) as TestConfigurationService;
		configurationService.setUserConfiguration('console.scrollbackSize', 1000);

		const sessionMetadata = createSessionMetadata('test-session');
		const session = disposables.add(new TestLanguageRuntimeSession(sessionMetadata, TestRuntimeMetadata));
		session.setRuntimeState(RuntimeState.Ready);

		const instance = disposables.add(instantiationService.createInstance(
			PositronConsoleInstance,
			'Test R',
			sessionMetadata,
			TestRuntimeMetadata,
		));
		instance.attachRuntimeSession(session, SessionAttachMode.Connected);

		return { instance, languageFeaturesService, session };
	}

	/** Polls `predicate` until it is true or the timeout elapses. */
	async function waitFor(predicate: () => boolean, timeout = 1000): Promise<void> {
		const start = Date.now();
		while (!predicate()) {
			if (Date.now() - start > timeout) {
				throw new Error('waitFor timed out');
			}
			await new Promise(resolve => setTimeout(resolve, 5));
		}
	}

	/** Registers a boundary provider that returns the given boundaries. */
	function registerBoundaryProvider(
		languageFeaturesService: ILanguageFeaturesService,
		boundaries: IInputBoundary[]
	): void {
		disposables.add(languageFeaturesService.inputBoundaryProvider.register(
			{ language: 'r', scheme: 'inmemory' },
			{ provideInputBoundaries: () => boundaries }
		));
	}

	it('does not clear the input editor when the code is incomplete', async () => {
		const { instance, languageFeaturesService } = createInstance();

		// The R provider reports `2 +` as a single incomplete statement.
		registerBoundaryProvider(languageFeaturesService, [
			{ range: { start: 0, end: 1 }, kind: 'incomplete' }
		]);

		// Record any request to overwrite the input editor's contents. The
		// continuation-prompt flow relies on the typed code staying in the
		// editor, so an incomplete submission must not fire this.
		const pendingCodeCalls: (string | undefined)[] = [];
		disposables.add(instance.onDidSetPendingCode(code => pendingCodeCalls.push(code)));

		const result = await instance.submitCode(
			'2 +',
			{ source: CodeAttributionSource.Interactive }
		);

		expect(result).toBe(CodeSubmissionResult.Incomplete);
		expect(pendingCodeCalls).toEqual([]);
	});

	it('executes the full multi-line code once it is complete', async () => {
		const { instance, languageFeaturesService } = createInstance();

		// After the continuation prompt, the input holds both lines. The R
		// provider now reports them as a single complete statement.
		registerBoundaryProvider(languageFeaturesService, [
			{ range: { start: 0, end: 2 }, kind: 'complete' }
		]);

		const executedCode: string[] = [];
		disposables.add(instance.onDidExecuteCode(e => executedCode.push(e.code)));

		const result = await instance.submitCode(
			'2 +\n3',
			{ source: CodeAttributionSource.Interactive }
		);

		expect(result).toBe(CodeSubmissionResult.Executed);
		expect(executedCode).toEqual(['2 +\n3']);
	});

	it('shows the continuation prompt when the session reports incomplete code (no provider)', async () => {
		const { instance, session } = createInstance();

		// No input boundary provider is registered, so completeness is checked by
		// the session over the Unprocessed mode (the Python path). Reject the
		// execution with a CodeIncompleteError, as the supervisor does for
		// incomplete input.
		const incompleteError = new Error('Code fragment is incomplete');
		incompleteError.name = RUNTIME_CODE_INCOMPLETE_ERROR;
		const executeSpy = vi.spyOn(session, 'execute').mockRejectedValue(incompleteError);

		const executedCode: string[] = [];
		disposables.add(instance.onDidExecuteCode(e => executedCode.push(e.code)));

		const result = await instance.submitCode(
			'def f():',
			{ source: CodeAttributionSource.Interactive }
		);

		expect(result).toBe(CodeSubmissionResult.Incomplete);
		// The session was asked to run the code in Unprocessed mode.
		expect(executeSpy).toHaveBeenCalledTimes(1);
		const [executedCodeArg, , modeArg] = executeSpy.mock.calls[0];
		expect(executedCodeArg).toBe('def f():');
		expect(modeArg).toBe(RuntimeCodeExecutionMode.Unprocessed);
		// Nothing executed, and the submission visuals are cleared.
		expect(executedCode).toEqual([]);
		expect(instance.codeSubmissionInProgress).toBe(false);
	});

	it('executes code the session accepts (no provider)', async () => {
		const { instance, session } = createInstance();

		// No provider: the session accepts the Unprocessed execution.
		vi.spyOn(session, 'execute').mockResolvedValue(undefined);

		const executedCode: string[] = [];
		disposables.add(instance.onDidExecuteCode(e => executedCode.push(e.code)));

		const result = await instance.submitCode(
			'40 + 2',
			{ source: CodeAttributionSource.Interactive }
		);

		expect(result).toBe(CodeSubmissionResult.Executed);
		// It is reported to the console as Interactive, not Unprocessed.
		expect(executedCode).toEqual(['40 + 2']);
	});

	it('queues code enqueued during an in-flight submission and runs it once the submission settles', async () => {
		const { instance, languageFeaturesService, session } = createInstance();

		// Make the boundary provider hang so the console submission stays in the
		// "submitting" state while we enqueue code from the editor.
		let resolveBoundaries!: (boundaries: IInputBoundary[]) => void;
		const boundariesPromise = new Promise<IInputBoundary[]>(resolve => {
			resolveBoundaries = resolve;
		});
		disposables.add(languageFeaturesService.inputBoundaryProvider.register(
			{ language: 'r', scheme: 'inmemory' },
			{ provideInputBoundaries: () => boundariesPromise }
		));

		// The queued code drains through the runtime completeness check (it is
		// not a provider-verified fragment); report it complete so it executes.
		vi.spyOn(session, 'isCodeFragmentComplete').mockResolvedValue(RuntimeCodeFragmentStatus.Complete);

		const executedCode: string[] = [];
		disposables.add(instance.onDidExecuteCode(e => executedCode.push(e.code)));

		// Start a console submission but do not await it; it is now in flight.
		const submission = instance.submitCode('2 +', { source: CodeAttributionSource.Interactive });
		expect(instance.codeSubmissionInProgress).toBe(true);

		// Enqueue code from the editor while the submission is in flight. This
		// must produce visible feedback (a pending input item) rather than
		// silently doing nothing.
		await instance.enqueueCode('editor_code', { source: CodeAttributionSource.Interactive });

		// The submitting code is promoted into the transcript (as a submitting
		// pending-input item), and the queued code appears after it, so run order
		// reads top-to-bottom.
		const pendingItems = instance.runtimeItems.filter(
			(item): item is RuntimeItemPendingInput => item instanceof RuntimeItemPendingInput);
		expect(pendingItems.map(item => ({ code: item.code, submitting: item.submitting }))).toEqual([
			{ code: '2 +', submitting: true },
			{ code: 'editor_code', submitting: false },
		]);
		expect(executedCode).toEqual([]);

		// While promoted, the input line is hidden (its code lives in the
		// transcript) so no empty prompt invites more input.
		expect(instance.submittingInputPromoted).toBe(true);

		// Resolve the console submission as incomplete: nothing executes and the
		// runtime is left idle, so no busy->idle transition would drain the queue.
		resolveBoundaries([{ range: { start: 0, end: 1 }, kind: 'incomplete' }]);
		expect(await submission).toBe(CodeSubmissionResult.Incomplete);

		// The placeholder is gone once the submission settles, so the input line
		// is shown again.
		expect(instance.submittingInputPromoted).toBe(false);

		// The queued editor code drains and executes once the submission settles.
		await waitFor(() => executedCode.includes('editor_code'));
	});
});
