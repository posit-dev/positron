/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Editor Action Bar: Modal Editor Overlay
 *
 * Regression guard for the upstream modal editor overlay (the dialog that Settings,
 * Keyboard Shortcuts, etc. open in). The modal renders its own header toolbar, so the
 * Positron editor action bar must not also render inside it. Previously it did,
 * producing a spurious second row of icons and leaking action bar widgets such as the
 * Quarto kernel status badge into the dialog.
 *
 * See posit-dev/positron#14781 and #14826.
 *
 * The modal is driven here via `workbench.editor.useModal: 'all'`, which routes every
 * editor into the overlay. Settings itself is deliberately NOT routed to the modal under
 * the smoke-test driver (see preferencesService.getEditorGroupFromOptions), and Workspace
 * Trust is disabled in e2e (--disable-workspace-trust), so neither can be used to reach
 * the modal here. `editor.actionBar.enabled` is turned on so the action bar *would* render
 * inside the modal if the suppression gate were missing, which is what makes the absence
 * assertion meaningful rather than vacuous.
 */

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Editor Action Bar: Modal Editor Overlay', {
	tag: [tags.WEB, tags.MODAL, tags.EDITOR_ACTION_BAR, tags.VSCODE_SETTINGS]
}, () => {

	test.afterEach(async function ({ runCommand }) {
		await runCommand('workbench.action.closeModalEditor');
	});

	test('does not render the Positron editor action bar inside the modal editor overlay', async function ({ page, settings, runCommand }) {
		// keepOpen: false forces the settings reload to settle before we open an editor,
		// so `useModal: 'all'` is in effect by the time the editor is routed.
		await settings.set(
			{ 'editor.actionBar.enabled': true, 'workbench.editor.useModal': 'all' },
			{ keepOpen: false }
		);

		await runCommand('workbench.action.files.newUntitledFile');

		const modal = page.locator('.monaco-modal-editor-block');
		await expect(modal).toBeVisible();

		// Wait for the editor content to render inside the modal before the negative
		// assertion. The action bar (if enabled) is prepended to the editor group as it
		// is created, so once the editor is present the enablement decision has already
		// been made -- this closes the race where an empty modal frame would let
		// `toHaveCount(0)` pass before a leaked action bar had a chance to appear.
		await expect(modal.locator('.monaco-editor').first()).toBeVisible();

		await expect(modal.locator('.editor-action-bar-container')).toHaveCount(0);
	});
});
