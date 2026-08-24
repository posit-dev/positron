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

	function renderEditor(ariaLabel?: string) {
		rtl.render(
			<EditableCodeEditor
				ref={createRef<EditableCodeEditorWidget>()}
				ariaLabel={ariaLabel}
				code='import pandas as pd'
				languageId='python'
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
});
