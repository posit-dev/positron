/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { ConsoleInputFocusTracker } from '../../../browser/positron/consoleInputFocusTracker.js';

/**
 * A fake code editor that can be told to take or lose text focus.
 */
interface FakeEditor {
	readonly editor: ICodeEditor;
	focus(): void;
	blur(): void;
}

describe('ConsoleInputFocusTracker', () => {
	const disposables = ensureNoLeakedDisposables();

	function createFakeEditor(options: { isSimpleWidget?: boolean; hasTextFocus?: boolean } = {}): FakeEditor {
		const onDidFocusEditorText = disposables.add(new Emitter<void>());
		// The tracker deliberately never subscribes to blur. The blur test below locks that in,
		// which is why the fake offers a blur nothing in production listens to.
		const onDidBlurEditorText = disposables.add(new Emitter<void>());
		const editor = stubInterface<ICodeEditor>({
			isSimpleWidget: options.isSimpleWidget ?? false,
			hasTextFocus: () => options.hasTextFocus ?? false,
			onDidFocusEditorText: onDidFocusEditorText.event,
			onDidBlurEditorText: onDidBlurEditorText.event,
		});
		return {
			editor,
			focus: () => onDidFocusEditorText.fire(),
			blur: () => onDidBlurEditorText.fire(),
		};
	}

	function startTracker(options: { existingEditors?: readonly ICodeEditor[] } = {}) {
		const onCodeEditorAdd = disposables.add(new Emitter<ICodeEditor>());
		const onCodeEditorRemove = disposables.add(new Emitter<ICodeEditor>());
		const codeEditorService = stubInterface<ICodeEditorService>({
			onCodeEditorAdd: onCodeEditorAdd.event,
			onCodeEditorRemove: onCodeEditorRemove.event,
			listCodeEditors: () => options.existingEditors ?? [],
		});

		const tracker = disposables.add(new ConsoleInputFocusTracker(codeEditorService));

		return {
			tracker,
			addEditor: (editor: ICodeEditor) => onCodeEditorAdd.fire(editor),
			removeEditor: (editor: ICodeEditor) => onCodeEditorRemove.fire(editor),
			focusedLast: () => tracker.lastFocusedConsoleSessionId,
		};
	}

	it('starts with no focused console', () => {
		// Until something takes focus the console is not the active document, so a call arriving
		// before the user has touched anything falls back to the editor.
		const tracker = startTracker();

		expect(tracker.focusedLast()).toBeUndefined();
	});

	it('records the session when its console input takes focus', () => {
		const consoleInput = createFakeEditor();
		const tracker = startTracker();
		tracker.addEditor(consoleInput.editor);
		disposables.add(tracker.tracker.trackConsoleInput('session-r', consoleInput.editor));

		consoleInput.focus();

		expect(tracker.focusedLast()).toBe('session-r');
	});

	it('records the most recently focused console when several are open', () => {
		// The reported bug: clicking the Python console must not authorize returning the R
		// console to an R-bound caller. https://github.com/posit-dev/positron/pull/16063
		const rInput = createFakeEditor();
		const pythonInput = createFakeEditor();
		const tracker = startTracker();
		tracker.addEditor(rInput.editor);
		tracker.addEditor(pythonInput.editor);
		disposables.add(tracker.tracker.trackConsoleInput('session-r', rInput.editor));
		disposables.add(tracker.tracker.trackConsoleInput('session-python', pythonInput.editor));
		rInput.focus();

		pythonInput.focus();

		expect(tracker.focusedLast()).toBe('session-python');
	});

	it('clears the session when a source editor takes focus', () => {
		const consoleInput = createFakeEditor();
		const paneEditor = createFakeEditor();
		const tracker = startTracker();
		tracker.addEditor(consoleInput.editor);
		tracker.addEditor(paneEditor.editor);
		disposables.add(tracker.tracker.trackConsoleInput('session-r', consoleInput.editor));
		consoleInput.focus();

		paneEditor.focus();

		expect(tracker.focusedLast()).toBeUndefined();
	});

	it('keeps the session when the console input blurs without another editor taking focus', () => {
		// Drag-selecting in the console output blurs the input, but no editor takes focus, so the
		// console is still the most recently focused editor.
		const consoleInput = createFakeEditor();
		const tracker = startTracker();
		tracker.addEditor(consoleInput.editor);
		disposables.add(tracker.tracker.trackConsoleInput('session-r', consoleInput.editor));
		consoleInput.focus();

		consoleInput.blur();

		expect(tracker.focusedLast()).toBe('session-r');
	});

	it('keeps the session when a simple widget takes focus', () => {
		// Find inputs and the SCM commit box are code editors too, but focusing one is not the
		// user moving to a source document.
		const consoleInput = createFakeEditor();
		const findInput = createFakeEditor({ isSimpleWidget: true });
		const tracker = startTracker();
		tracker.addEditor(consoleInput.editor);
		tracker.addEditor(findInput.editor);
		disposables.add(tracker.tracker.trackConsoleInput('session-r', consoleInput.editor));
		consoleInput.focus();

		findInput.focus();

		expect(tracker.focusedLast()).toBe('session-r');
	});

	it('treats an editor as a console input when it is registered after the editor is added', () => {
		// The real ordering: the widget registers with ICodeEditorService during construction,
		// and the console's editor is handed over afterwards.
		const consoleInput = createFakeEditor();
		const tracker = startTracker();
		tracker.addEditor(consoleInput.editor);

		disposables.add(tracker.tracker.trackConsoleInput('session-r', consoleInput.editor));
		consoleInput.focus();

		expect(tracker.focusedLast()).toBe('session-r');
	});

	it('records a console input that already has focus when it is registered', () => {
		// The extension host restarts with the console input already focused. The tracker is
		// rebuilt with it (`MainThreadConsoleService` is a per-extension-host customer), but no
		// focus event fires because focus never moved, so registration has to read the current
		// state. A source editor holding focus needs no equivalent seed: `undefined` already
		// means "a source editor was focused last".
		const consoleInput = createFakeEditor({ hasTextFocus: true });
		const tracker = startTracker({ existingEditors: [consoleInput.editor] });

		disposables.add(tracker.tracker.trackConsoleInput('session-r', consoleInput.editor));

		expect(tracker.focusedLast()).toBe('session-r');
	});

	it('stops attributing focus to a session once the console input is unregistered', () => {
		// The console view unmounted, so this editor is no longer anyone's console input.
		const consoleInput = createFakeEditor();
		const tracker = startTracker();
		tracker.addEditor(consoleInput.editor);
		const registration = tracker.tracker.trackConsoleInput('session-r', consoleInput.editor);

		registration.dispose();
		consoleInput.focus();

		expect(tracker.focusedLast()).toBeUndefined();
	});

	it('tracks editors that already existed when it started', () => {
		const consoleInput = createFakeEditor();
		const tracker = startTracker({ existingEditors: [consoleInput.editor] });
		disposables.add(tracker.tracker.trackConsoleInput('session-r', consoleInput.editor));

		consoleInput.focus();

		expect(tracker.focusedLast()).toBe('session-r');
	});

	it('stops tracking an editor once it is removed', () => {
		const consoleInput = createFakeEditor();
		const paneEditor = createFakeEditor();
		const tracker = startTracker();
		tracker.addEditor(consoleInput.editor);
		tracker.addEditor(paneEditor.editor);
		disposables.add(tracker.tracker.trackConsoleInput('session-r', consoleInput.editor));
		consoleInput.focus();

		tracker.removeEditor(paneEditor.editor);
		paneEditor.focus();

		expect(tracker.focusedLast()).toBe('session-r');
	});
});
