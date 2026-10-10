/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IUserInteractionService } from '../../../../../platform/userInteraction/browser/userInteractionService.js';
import { UserInteractionService } from '../../../../../platform/userInteraction/browser/userInteractionServiceImpl.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronConsoleInstance, IPositronConsoleService, PositronConsoleState } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IExecutionHistoryService } from '../../../../services/positronHistory/common/executionHistoryService.js';
import { ConsoleInput } from '../../browser/components/consoleInput.js';
import { PositronConsoleContextProvider, usePositronConsoleContext } from '../../browser/positronConsoleContext.js';

/**
 * Mock the focus guard so each test can say whether the user is working somewhere the console
 * must not take focus from. The guard has its own tests in consoleInputFocus.vitest.ts.
 */
const { mockOkToTakeFocus } = vi.hoisted(() => ({ mockOkToTakeFocus: vi.fn() }));
vi.mock('../../browser/components/consoleInputFocus.js', () => ({ okToTakeFocus: mockOkToTakeFocus }));

/**
 * Mock the input's text model with a plain one that is destroyed when the input unmounts. The real
 * one holds a reference through the text file resolver, which outlives the test. It has its own
 * tests in consoleInputModel.vitest.ts.
 */
vi.mock('../../browser/components/consoleInputModel.js', () => ({
	createConsoleInputModel: (
		modelService: IModelService,
		_textModelService: ITextModelService,
		languageService: ILanguageService,
		languageId: string,
		_isNotebook: boolean,
		store: DisposableStore
	) => {
		const model = modelService.createModel('', languageService.createById(languageId));
		store.add({ dispose: () => modelService.destroyModel(model.uri) });
		return model;
	},
}));

/**
 * Creates a console instance stub with no session attached.
 */
function createConsoleInstance(sessionId: string): IPositronConsoleInstance {
	return stubInterface<IPositronConsoleInstance>({
		sessionId,
		sessionMetadata: stubInterface<IPositronConsoleInstance['sessionMetadata']>({
			sessionId,
			sessionMode: LanguageRuntimeSessionMode.Console,
		}),
		runtimeMetadata: stubInterface<IPositronConsoleInstance['runtimeMetadata']>({ languageId: 'r' }),
		attachedRuntimeSession: undefined,
		state: PositronConsoleState.Ready,
		scrollLocked: false,
		onFocusInput: Event.None,
		onDidChangeState: Event.None,
		onDidPasteText: Event.None,
		onDidClearConsole: Event.None,
		onDidNavigateInputHistoryDown: Event.None,
		onDidNavigateInputHistoryUp: Event.None,
		onDidEngageHistoryInfixSearch: Event.None,
		onDidClearInputHistory: Event.None,
		onDidSetPendingCode: Event.None,
		onDidExecuteCode: Event.None,
	});
}

/**
 * Renders a console input the way ConsoleInstance does: inert unless its console is the active one.
 */
function TestConsole(props: { instance: IPositronConsoleInstance; hidden: boolean }) {
	const positronConsoleContext = usePositronConsoleContext();
	const active = positronConsoleContext.activePositronConsoleInstance?.sessionId === props.instance.sessionId;
	return (
		<div inert={!active}>
			<ConsoleInput
				hidden={props.hidden}
				positronConsoleInstance={props.instance}
				width={400}
				onCodeExecuted={() => { }}
				onSelectAll={() => { }}
			/>
		</div>
	);
}

describe('ConsoleInput focus', () => {
	const onDidChangeActiveInstance = new Emitter<IPositronConsoleInstance | undefined>();
	let activeInstance: IPositronConsoleInstance | undefined;

	const ctx = createTestContainer()
		.withReactServices()
		// The editor's view needs IUserInteractionService for its DOM focus tracker. Use the real
		// implementation so it follows jsdom focus and blur events.
		.stub(IUserInteractionService, new UserInteractionService())
		.stub(IExecutionHistoryService, { getSessionInputEntries: () => [] })
		.stub(IPositronConsoleService, {
			get positronConsoleInstances() { return activeInstance ? [activeInstance] : []; },
			get activePositronConsoleInstance() { return activeInstance; },
			onDidChangeActivePositronConsoleInstance: onDidChangeActiveInstance.event,
			onDidStartPositronConsoleInstance: Event.None,
			onDidDeletePositronConsoleInstance: Event.None,
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const thisConsole = createConsoleInstance('this-console');
	const otherConsole = createConsoleInstance('other-console');

	beforeEach(() => {
		activeInstance = undefined;
		mockOkToTakeFocus.mockReturnValue(true);

		// The input builds its editor options from these sections.
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		configurationService.setUserConfiguration('editor', {});
		configurationService.setUserConfiguration('console', {});

		// jsdom lets focus land anywhere. Browsers ignore focus() inside an inert subtree or a
		// display: none one (the hidden console input), which is what these tests are about.
		const focus = HTMLElement.prototype.focus;
		vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
			if (!this.closest('[inert], .console-input.hidden')) {
				focus.call(this, options);
			}
		});
	});

	function renderConsole(hidden: boolean) {
		const result = rtl.render(
			<PositronConsoleContextProvider>
				<TestConsole hidden={hidden} instance={thisConsole} />
			</PositronConsoleContextProvider>
		);
		return {
			editor: screen.getByRole('textbox'),
			setHidden: (value: boolean) => result.rerender(
				<PositronConsoleContextProvider>
					<TestConsole hidden={value} instance={thisConsole} />
				</PositronConsoleContextProvider>
			),
		};
	}

	function makeActive(instance: IPositronConsoleInstance) {
		act(() => {
			activeInstance = instance;
			onDidChangeActiveInstance.fire(instance);
		});
	}

	describe('when its console becomes the active one', () => {
		// Deleting the active console makes another one active. That console is still inert when
		// the change is announced, so a focus attempt made right then is ignored.
		it('takes focus', () => {
			activeInstance = otherConsole;
			const { editor } = renderConsole(false);

			makeActive(thisConsole);

			expect(editor).toHaveFocus();
		});

		it('leaves focus alone when it mounts while the user is working elsewhere', () => {
			activeInstance = thisConsole;
			mockOkToTakeFocus.mockReturnValue(false);

			const { editor } = renderConsole(false);

			expect(editor).not.toHaveFocus();
		});

		it('leaves focus alone while the user is working elsewhere', () => {
			activeInstance = otherConsole;
			const { editor } = renderConsole(false);
			mockOkToTakeFocus.mockReturnValue(false);

			makeActive(thisConsole);

			expect(editor).not.toHaveFocus();
		});
	});

	describe('when its input is shown again', () => {
		/**
		 * Renders the active console, focuses its input as a click into it does, then hides the
		 * input as a restart does. Browsers drop focus from an element that becomes display: none;
		 * jsdom does not, so blur it by hand. A restart keeps the input hidden for a while, so let
		 * pending timers run before it is shown again.
		 */
		async function renderAndHideFocusedInput() {
			activeInstance = thisConsole;
			const rendered = renderConsole(false);
			act(() => rendered.editor.focus());
			expect(rendered.editor).toHaveFocus();
			rendered.setHidden(true);
			act(() => rendered.editor.blur());
			await act(() => new Promise(resolve => setTimeout(resolve, 0)));
			return rendered;
		}

		it('takes focus', async () => {
			const { editor, setHidden } = await renderAndHideFocusedInput();

			setHidden(false);

			expect(editor).toHaveFocus();
		});

		it('leaves focus alone if the user moved somewhere else while it was hidden', async () => {
			const { editor, setHidden } = await renderAndHideFocusedInput();
			const elsewhere = document.body.appendChild(document.createElement('button'));
			onTestFinished(() => elsewhere.remove());
			act(() => elsewhere.focus());
			mockOkToTakeFocus.mockReturnValue(false);

			setHidden(false);

			expect(elsewhere).toHaveFocus();
			expect(editor).not.toHaveFocus();
		});
	});
});
