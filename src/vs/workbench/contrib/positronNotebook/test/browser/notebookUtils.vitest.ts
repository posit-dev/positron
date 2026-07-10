/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IVisibleEditorPane } from '../../../../common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { NOTEBOOK_EDITOR_ID } from '../../../notebook/common/notebookCommon.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../common/positronNotebookCommon.js';
import {
	UNSUPPORTED_NOTEBOOK_EDITOR_MESSAGE,
	getUnsupportedNotebookEditorMessage,
} from '../../browser/notebookUtils.js';

function editorServiceWithActivePane(editorId: string | undefined): IEditorService {
	const activeEditorPane = editorId === undefined
		? undefined
		: stubInterface<IVisibleEditorPane>({ getId: () => editorId });
	return stubInterface<IEditorService>({ activeEditorPane });
}

describe('getUnsupportedNotebookEditorMessage', () => {
	it('returns the actionable message when a notebook is open in the built-in editor', () => {
		const editorService = editorServiceWithActivePane(NOTEBOOK_EDITOR_ID);

		const message = getUnsupportedNotebookEditorMessage(editorService);

		expect(message).toBe(UNSUPPORTED_NOTEBOOK_EDITOR_MESSAGE);
		expect(message).toContain('Positron Notebook Editor');
	});

	it('returns undefined when the active editor is a Positron notebook', () => {
		const editorService = editorServiceWithActivePane(POSITRON_NOTEBOOK_EDITOR_ID);

		expect(getUnsupportedNotebookEditorMessage(editorService)).toBeUndefined();
	});

	it('returns undefined when no editor is active', () => {
		const editorService = editorServiceWithActivePane(undefined);

		expect(getUnsupportedNotebookEditorMessage(editorService)).toBeUndefined();
	});

	it('returns undefined for an unrelated (non-notebook) editor', () => {
		const editorService = editorServiceWithActivePane('workbench.editors.files.textFileEditor');

		expect(getUnsupportedNotebookEditorMessage(editorService)).toBeUndefined();
	});
});
