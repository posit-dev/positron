/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import { MenuId, MenuRegistry, isIMenuItem } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyValue, IContext } from '../../../../../platform/contextkey/common/contextkey.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../../positronNotebook/common/positronNotebookCommon.js';
import { POSITRON_NOTEBOOK_IS_NOT_ACTIVE_EDITOR } from '../../common/notebookContextKeys.js';

// Side-effect imports: trigger registerAction2() calls that add commands to MenuRegistry
import '../../browser/controller/layoutActions.js';
import '../../browser/contrib/troubleshoot/layout.js';
import '../../browser/contrib/clipboard/notebookClipboard.js';
import '../../browser/services/notebookKernelHistoryServiceImpl.js';
import '../../browser/viewParts/notebookViewZones.js';

/**
 * Upstream notebook command IDs that should be hidden from the command palette
 * when the Positron notebook editor is active.
 *
 * 'notebook.cellOutput.addToChat' is excluded because it is registered via
 * extensions/ipynb/package.json, not registerAction2(), so it is not present
 * in MenuRegistry during core unit tests.
 */
const HIDDEN_COMMAND_IDS = [
	'workbench.notebook.layout.configure',
	'notebook.action.toggleNotebookStickyScroll',
	'notebook.clearNotebookEdtitorTypeCache',
	'notebook.clearNotebookKernelsMRUCache',
	'notebook.inspectLayout',
	'notebook.toggleLayoutTroubleshoot',
	'workbench.action.toggleNotebookClipboardLog',
	'notebook.developer.addViewZones',
];

function createContext(values: Record<string, ContextKeyValue>): IContext {
	return { getValue: <T extends ContextKeyValue>(key: string) => values[key] as T | undefined };
}

suite('Positron Notebook Command Palette Visibility', () => {
	createTestContainer().build();

	test('POSITRON_NOTEBOOK_IS_NOT_ACTIVE_EDITOR evaluates correctly', () => {
		assert.strictEqual(
			POSITRON_NOTEBOOK_IS_NOT_ACTIVE_EDITOR.evaluate(
				createContext({ activeEditor: POSITRON_NOTEBOOK_EDITOR_ID })
			),
			false,
			'should be false when Positron notebook is the active editor'
		);

		assert.strictEqual(
			POSITRON_NOTEBOOK_IS_NOT_ACTIVE_EDITOR.evaluate(
				createContext({ activeEditor: 'workbench.editor.notebook' })
			),
			true,
			'should be true when upstream notebook is the active editor'
		);

		assert.strictEqual(
			POSITRON_NOTEBOOK_IS_NOT_ACTIVE_EDITOR.evaluate(
				createContext({})
			),
			true,
			'should be true when no editor is active'
		);
	});

	test('hidden commands have when clauses that exclude the Positron notebook editor', () => {
		const positronContext = createContext({
			activeEditor: POSITRON_NOTEBOOK_EDITOR_ID,
			// isDevelopment is true so the AND with IsDevelopmentContext still
			// evaluates; the Positron gate should make the result false.
			isDevelopment: true,
		});
		const paletteItems = MenuRegistry.getMenuItems(MenuId.CommandPalette);
		const foundCommands = new Set<string>();

		for (const item of paletteItems) {
			if (isIMenuItem(item) && HIDDEN_COMMAND_IDS.includes(item.command.id)) {
				foundCommands.add(item.command.id);
				assert.ok(
					item.when,
					`Command '${item.command.id}' should have a 'when' clause`
				);
				assert.strictEqual(
					item.when.evaluate(positronContext),
					false,
					`Command '${item.command.id}' should be hidden when Positron notebook editor is active`
				);
			}
		}

		for (const id of HIDDEN_COMMAND_IDS) {
			assert.ok(
				foundCommands.has(id),
				`Command '${id}' should be registered in the CommandPalette`
			);
		}
	});

	test('hidden commands are visible when upstream notebook editor is active', () => {
		const upstreamContext = createContext({
			activeEditor: 'workbench.editor.notebook',
			// notebook.developer.addViewZones also requires IsDevelopmentContext
			isDevelopment: true,
		});
		const paletteItems = MenuRegistry.getMenuItems(MenuId.CommandPalette);

		for (const item of paletteItems) {
			if (isIMenuItem(item) && HIDDEN_COMMAND_IDS.includes(item.command.id)) {
				assert.strictEqual(
					item.when!.evaluate(upstreamContext),
					true,
					`Command '${item.command.id}' should be visible when upstream notebook editor is active`
				);
			}
		}
	});
});
