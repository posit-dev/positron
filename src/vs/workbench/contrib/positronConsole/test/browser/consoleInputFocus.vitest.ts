/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { ContextKeyValue } from '../../../../../platform/contextkey/common/contextkey.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { EditorContextKeys } from '../../../../../editor/common/editorContextKeys.js';
import { InQuickPickContextKey } from '../../../../browser/quickaccess.js';
import { TerminalContextKeys } from '../../../terminal/common/terminalContextKey.js';
import { FocusedViewContext } from '../../../../common/contextkeys.js';
import { IWebview, IWebviewService } from '../../../webview/browser/webview.js';
import { IWorkbenchLayoutService, Parts } from '../../../../services/layout/browser/layoutService.js';
import { POSITRON_CONSOLE_VIEW_ID } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { okToTakeFocus } from '../../browser/components/consoleInputFocus.js';

interface Scenario {
	/**
	 * Keys set on the root context key service, the way viewsService sets
	 * `focusedView`.
	 */
	rootKeys?: Record<string, ContextKeyValue>;
	/**
	 * Keys set on a context key service scoped to the focused element, the way an
	 * editor or the terminal binds its own focus keys. The guard has to resolve
	 * these through the DOM, which is why the test uses a real
	 * `ContextKeyService` rather than a stub.
	 */
	widgetKeys?: Record<string, ContextKeyValue>;
	editorPartHasFocus?: boolean;
	/**
	 * Whether a webview holds focus. A webview mounts its iframe outside its view
	 * pane, so this is the only signal the guard gets for focus in a chat view
	 * contributed by an extension or in the Help pane.
	 */
	webviewHasFocus?: boolean;
}

describe('okToTakeFocus', () => {
	let disposables: DisposableStore;

	beforeEach(() => {
		ensureNoLeakedDisposables();
		disposables = new DisposableStore();
	});

	afterEach(() => disposables.dispose());

	/**
	 * Asks the guard about an element that is inside a scoped context, with the
	 * given keys set on the root and scoped services.
	 */
	function check({
		rootKeys = {},
		widgetKeys = {},
		editorPartHasFocus = false,
		webviewHasFocus = false,
	}: Scenario = {}): boolean {
		const contextKeyService = disposables.add(
			new ContextKeyService(new TestConfigurationService())
		);
		for (const [key, value] of Object.entries(rootKeys)) {
			contextKeyService.createKey(key, value);
		}

		// The focused element sits inside its own scope, so scoped keys resolve
		// from it and root keys still fall through to it.
		const focusedElement = document.createElement('div');
		const scoped = disposables.add(contextKeyService.createScoped(focusedElement));
		for (const [key, value] of Object.entries(widgetKeys)) {
			scoped.createKey(key, value);
		}

		const layoutService = stubInterface<IWorkbenchLayoutService>({
			hasFocus: (part: Parts) => part === Parts.EDITOR_PART && editorPartHasFocus
		});

		const webviewService = stubInterface<IWebviewService>({
			activeWebview: webviewHasFocus ? stubInterface<IWebview>() : undefined
		});

		return okToTakeFocus(contextKeyService, layoutService, webviewService, focusedElement);
	}

	// Every surface the guard has to refuse. One case per surface; the guard's
	// job here is uniform, so the interesting cases are the two below.
	it.each<[string, Scenario]>([
		['a text editor or simple text input', { widgetKeys: { [EditorContextKeys.textInputFocus.key]: true } }],
		['a quick pick', { widgetKeys: { [InQuickPickContextKey.key]: true } }],
		['the terminal', { widgetKeys: { [TerminalContextKeys.focus.key]: true } }],
		['another view', { rootKeys: { [FocusedViewContext.key]: 'workbench.view.search' } }],
		['the editor part', { editorPartHasFocus: true }],
		['a webview, e.g. an extension chat view or the Help pane', { webviewHasFocus: true }],
	])('refuses focus when %s has it', (_surface, scenario) => {
		expect(check(scenario)).toBe(false);
	});

	// On an idle launch nothing meaningful holds focus, so the console takes it:
	// console-first users expect to launch Positron and start typing. Both empty
	// shapes occur in production, `undefined` before viewsService binds the key
	// and `''` after it resets the key on view blur, and neither may count as a
	// focused view. A guard that compared `focusedView` to the console id without
	// the empty check would refuse focus here and regress the idle launch.
	it('takes focus on an idle launch, whether focusedView is unset or reset to empty', () => {
		expect({
			unset: check(),
			resetToEmpty: check({ rootKeys: { [FocusedViewContext.key]: '' } }),
		}).toEqual({ unset: true, resetToEmpty: true });
	});

	// Focus already inside the console view is not focus worth protecting; that
	// is where the console input lives. Refusing here would break switching
	// between console session tabs.
	it('takes focus when focus is already in the console view', () => {
		expect(check({ rootKeys: { [FocusedViewContext.key]: POSITRON_CONSOLE_VIEW_ID } })).toBe(true);
	});
});
