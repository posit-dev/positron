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
import { CodeSubmissionResult, IConsoleFindWidget, IConsoleFindWidgetFactory, SessionAttachMode } from '../../browser/interfaces/positronConsoleService.js';
import { ConsoleErrorFollowupService, IConsoleErrorFollowupService } from '../../common/consoleErrorFollowup.js';
import { CodeAttributionSource } from '../../common/positronConsoleCodeExecution.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, RuntimeState } from '../../../languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionMetadata } from '../../../runtimeSession/common/runtimeSessionService.js';

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

		return { instance, languageFeaturesService };
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
});
