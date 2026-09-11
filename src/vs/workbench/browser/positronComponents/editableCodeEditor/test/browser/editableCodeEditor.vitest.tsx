/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createRef } from 'react';
import { screen } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { IUserInteractionService } from '../../../../../../platform/userInteraction/browser/userInteractionService.js';
import { UserInteractionService } from '../../../../../../platform/userInteraction/browser/userInteractionServiceImpl.js';
import { ICodeEditorService } from '../../../../../../editor/browser/services/codeEditorService.js';
import { EditorOption } from '../../../../../../editor/common/config/editorOptions.js';
import { ILanguageService } from '../../../../../../editor/common/languages/language.js';
import { IRuntimeSessionService } from '../../../../../services/runtimeSession/common/runtimeSessionService.js';
import { EditableCodeEditor, EditableCodeEditorWidget } from '../../editableCodeEditor.js';

describe('EditableCodeEditor', () => {
	const ctx = createTestContainer()
		.withReactServices()
		// The editor's view needs IUserInteractionService to create its DOM focus tracker. Use the
		// real implementation so it wires up to genuine jsdom focus/blur events.
		.stub(IUserInteractionService, new UserInteractionService())
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// jsdom never computes layout, so Monaco's container measures 0x0 and renders no view-lines.
	// Give every element a real size so the editor lays out.
	beforeEach(() => {
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
			width: 660, height: 260, top: 0, left: 0, right: 660, bottom: 260, x: 0, y: 0, toJSON: () => ({}),
		});
		vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(660);
		vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(260);
	});

	function renderEditor(ariaLabel?: string, languageId = 'python') {
		rtl.render(
			<EditableCodeEditor
				ref={createRef<EditableCodeEditorWidget>()}
				ariaLabel={ariaLabel}
				code='import pandas as pd'
				languageId={languageId}
			/>
		);
	}

	it('announces the given aria label', () => {
		renderEditor('Import code');

		expect(screen.getByRole('textbox')).toHaveAccessibleName('Import code');
	});

	it('lets Tab move focus out of the editor', () => {
		renderEditor();

		// tabFocusMode drives the editorTabMovesFocus context key, whose negation gates the
		// editor's Tab-indents-the-line keybinding. With it set, Tab resolves to no editor command
		// and the browser moves focus to the next control.
		const editor = ctx.get(ICodeEditorService).listCodeEditors()[0];
		expect(editor.getOption(EditorOption.tabFocusMode)).toBe(true);
	});

	it('does not let a preview of a language implicitly start a session for it', () => {
		// Encountering a language is what Positron reads as a document in that language being
		// opened, which implicitly starts a session. Record whether implicit startup was suppressed
		// at the moment the preview's language was encountered, which is the state the startup
		// heuristic reads.
		const runtimeSessionService = ctx.get(IRuntimeSessionService);
		const suppressedWhenEncountered: boolean[] = [];
		ctx.disposables.add(ctx.get(ILanguageService).onDidRequestRichLanguageFeatures(
			() => suppressedWhenEncountered.push(runtimeSessionService.implicitStartupSuppressed)
		));

		renderEditor(undefined, 'r');

		// The language is encountered under suppression, and the suppression does not outlive the
		// model's creation: leaving it on would silently disable auto-start for the whole window.
		expect({
			suppressedWhenEncountered,
			suppressedAfterwards: runtimeSessionService.implicitStartupSuppressed,
		}).toMatchInlineSnapshot(`
			{
			  "suppressedAfterwards": false,
			  "suppressedWhenEncountered": [
			    true,
			  ],
			}
		`);
	});
});
