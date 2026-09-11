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
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { TestLanguageRuntimeSession } from '../../../runtimeSession/test/common/testLanguageRuntimeSession.js';
import { PositronConsoleInstance } from '../../browser/positronConsoleService.js';
import { RuntimeItemActivity } from '../../browser/classes/runtimeItemActivity.js';
import { ActivityItemInput, ActivityItemInputState } from '../../browser/classes/activityItemInput.js';
import { IConsoleFindWidget, IConsoleFindWidgetFactory, PositronConsoleState, SessionAttachMode } from '../../browser/interfaces/positronConsoleService.js';
import { ConsoleErrorFollowupService, IConsoleErrorFollowupService } from '../../common/consoleErrorFollowup.js';
import { ILanguageRuntimeCodeExecutedEvent } from '../../common/positronConsoleCodeExecution.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, RuntimeOnlineState, RuntimeState } from '../../../languageRuntime/common/languageRuntimeService.js';
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

const SESSION_METADATA: IRuntimeSessionMetadata = {
	sessionId: 'test-session',
	createdTimestamp: 0,
	sessionMode: LanguageRuntimeSessionMode.Console,
	notebookUri: undefined,
	startReason: 'Unit Test'
};

/** The attribution the kernel supervisor sends for agent-run code. */
const CLAUDE_CODE_ATTRIBUTION = {
	source: 'agent',
	metadata: { agentName: 'claude-code', agentVersion: '2.1.0', tool: 'execute_code' },
};

function createInstance(disposables: DisposableStore): {
	instance: PositronConsoleInstance;
	session: TestLanguageRuntimeSession;
} {
	const instantiationService = createModelServices(disposables, [
		[IConsoleFindWidgetFactory, TestConsoleFindWidgetFactory],
		[IConsoleErrorFollowupService, ConsoleErrorFollowupService],
	]);
	disposables.add(instantiationService.get(ILanguageService).registerLanguage({ id: 'r' }));
	// The model service is created lazily; force it so the instance can use it.
	instantiationService.get(IModelService);

	const session = disposables.add(
		new TestLanguageRuntimeSession(SESSION_METADATA, TestRuntimeMetadata));
	session.setRuntimeState(RuntimeState.Ready);

	const instance = disposables.add(instantiationService.createInstance(
		PositronConsoleInstance,
		'Test R',
		SESSION_METADATA,
		TestRuntimeMetadata,
	));
	instance.attachRuntimeSession(session, SessionAttachMode.Connected);

	return { instance, session };
}

/** The input activity items in the transcript, in order. */
function inputItems(instance: PositronConsoleInstance): ActivityItemInput[] {
	return instance.runtimeItems
		.filter((item): item is RuntimeItemActivity => item instanceof RuntimeItemActivity)
		.flatMap(item => item.activityItems)
		.filter((item): item is ActivityItemInput => item instanceof ActivityItemInput);
}

describe('PositronConsoleInstance agent attribution', () => {
	const disposables = new DisposableStore();

	afterEach(() => {
		disposables.clear();
	});

	it('shows announced agent code before the runtime echoes it', () => {
		const { instance, session } = createInstance(disposables);

		session.receiveExecutionRequestedMessage({
			parent_id: 'agent-exec-1',
			code: 'summary(mtcars)',
			attribution: CLAUDE_CODE_ATTRIBUTION,
		});

		expect(inputItems(instance).map(item => ({
			code: item.code,
			state: item.state,
			attributionLabel: item.attributionLabel,
		}))).toEqual([
			{
				code: 'summary(mtcars)',
				state: ActivityItemInputState.Provisional,
				attributionLabel: 'claude-code',
			},
		]);
	});

	it('keeps the attribution when the runtime echoes the code', () => {
		const { instance, session } = createInstance(disposables);

		session.receiveExecutionRequestedMessage({
			parent_id: 'agent-exec-1',
			code: 'summary(mtcars)',
			attribution: CLAUDE_CODE_ATTRIBUTION,
		});
		session.receiveInputMessage({ parent_id: 'agent-exec-1', code: 'summary(mtcars)' });

		// The echo replaces the provisional item rather than adding a second
		// copy of the code, and carries the label over.
		expect(inputItems(instance).map(item => ({
			code: item.code,
			state: item.state,
			attributionLabel: item.attributionLabel,
		}))).toEqual([
			{
				code: 'summary(mtcars)',
				state: ActivityItemInputState.Executing,
				attributionLabel: 'claude-code',
			},
		]);
	});

	it('names the agent generically when it did not identify itself', () => {
		const { instance, session } = createInstance(disposables);

		session.receiveExecutionRequestedMessage({
			parent_id: 'agent-exec-1',
			code: '1 + 1',
			attribution: { source: 'agent' },
		});

		expect(inputItems(instance).map(item => item.attributionLabel))
			.toEqual(['External agent']);
	});

	it('follows the busy state of an agent execution', () => {
		const { instance, session } = createInstance(disposables);

		session.receiveExecutionRequestedMessage({
			parent_id: 'agent-exec-1',
			code: 'Sys.sleep(1)',
			attribution: CLAUDE_CODE_ATTRIBUTION,
		});

		const states: PositronConsoleState[] = [];
		disposables.add(instance.onDidChangeState(state => states.push(state)));

		session.receiveStateMessage({ parent_id: 'agent-exec-1', state: RuntimeOnlineState.Busy });
		session.receiveStateMessage({ parent_id: 'agent-exec-1', state: RuntimeOnlineState.Idle });

		expect(states).toEqual([PositronConsoleState.Busy, PositronConsoleState.Ready]);
	});

	it('reports agent code as executed so it reaches the console history', () => {
		const { instance, session } = createInstance(disposables);

		const executed: ILanguageRuntimeCodeExecutedEvent[] = [];
		disposables.add(instance.onDidExecuteCode(event => executed.push(event)));

		session.receiveExecutionRequestedMessage({
			parent_id: 'agent-exec-1',
			code: 'summary(mtcars)',
			attribution: CLAUDE_CODE_ATTRIBUTION,
		});

		expect(executed.map(event => ({
			executionId: event.executionId,
			sessionId: event.sessionId,
			languageId: event.languageId,
			code: event.code,
			attribution: event.attribution,
		}))).toEqual([
			{
				executionId: 'agent-exec-1',
				sessionId: 'test-session',
				languageId: 'r',
				code: 'summary(mtcars)',
				attribution: CLAUDE_CODE_ATTRIBUTION,
			},
		]);
	});
});
