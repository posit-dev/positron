/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ResourceContextKey } from '../../../common/contextkeys.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { QUARTO_INLINE_OUTPUT_ENABLED, QUARTO_LANGUAGE_IDS } from '../common/positronQuartoConfig.js';
import { QuartoCommandId } from './quartoCommands.js';
import { IQuartoKernelManager } from './quartoKernelManager.js';

// Per-pane lang-id check: the global IS_QUARTO_DOCUMENT context key would
// leak this entry into adjacent editor groups, the same way it would for the
// kernel status widget (see comment in positronQuarto.contribution.ts).
const QUARTO_LANG_WHEN = ContextKeyExpr.or(
	...QUARTO_LANGUAGE_IDS.map(id => ContextKeyExpr.equals(ResourceContextKey.LangId.key, id))
);

// Preview is offered more broadly than the other Quarto actions.
const QUARTO_PREVIEW_LANG_WHEN = ContextKeyExpr.or(
	...[...QUARTO_LANGUAGE_IDS, 'markdown'].map(id => ContextKeyExpr.equals(ResourceContextKey.LangId.key, id))
);

// Outer submenu attached to the editor action bar's leftmost slot.
// Group `navigation` is special-cased to render before `0_preview` (Quarto
// extension's Render button) and `1_save` (Save button), placing this entry
// at the very left for .qmd / .rmd documents.
//
// The factory unwraps a submenu with a single visible item to a plain button,
// so when inline output is disabled (only Run All visible), this renders as a
// simple icon button. When inline output is enabled, the additional items make
// it a split button: the run-all icon stays as the primary action and a
// dropdown chevron exposes the rest.
MenuRegistry.appendMenuItem(MenuId.EditorActionsLeft, {
	submenu: MenuId.PositronQuartoEditorActionBarMenu,
	title: localize2('quarto.editorActionBar.runAll', "Run All"),
	icon: ThemeIcon.fromId('run-all'),
	group: 'navigation',
	order: 0,
	when: QUARTO_LANG_WHEN,
	isSplitButton: { togglePrimaryAction: true },
});

// Run All - primary action, always present. Delegates to the Quarto
// extension's runAllCells command, which knows how to enumerate and execute
// every code cell in the document.
MenuRegistry.appendMenuItem(MenuId.PositronQuartoEditorActionBarMenu, {
	command: {
		id: 'quarto.runAllCells',
		title: localize2('quarto.editorActionBar.runAllCells', "Run All"),
		icon: ThemeIcon.fromId('run-all'),
	},
	group: 'navigation',
	order: 10,
});

// Inline-output-only items below. Distinct group names produce a visible
// separator between sections in the dropdown.
MenuRegistry.appendMenuItem(MenuId.PositronQuartoEditorActionBarMenu, {
	command: {
		id: QuartoCommandId.ClearAllOutputs,
		title: localize2('quarto.editorActionBar.clearAllOutputs', "Clear All Outputs"),
	},
	group: '1_clear',
	order: 10,
	when: QUARTO_INLINE_OUTPUT_ENABLED,
});

MenuRegistry.appendMenuItem(MenuId.PositronQuartoEditorActionBarMenu, {
	command: {
		id: QuartoCommandId.ExpandAllOutputs,
		title: localize2('quarto.editorActionBar.expandAllOutputs', "Expand All Outputs"),
	},
	group: '2_collapse',
	order: 10,
	when: QUARTO_INLINE_OUTPUT_ENABLED,
});

MenuRegistry.appendMenuItem(MenuId.PositronQuartoEditorActionBarMenu, {
	command: {
		id: QuartoCommandId.CollapseAllOutputs,
		title: localize2('quarto.editorActionBar.collapseAllOutputs', "Collapse All Outputs"),
	},
	group: '2_collapse',
	order: 20,
	when: QUARTO_INLINE_OUTPUT_ENABLED,
});

MenuRegistry.appendMenuItem(MenuId.PositronQuartoEditorActionBarMenu, {
	command: {
		id: 'workbench.action.positronConsole.showNotebookConsole',
		title: localize2('quarto.editorActionBar.showNotebookConsole', "Show Console"),
	},
	group: '3_console',
	order: 10,
	when: QUARTO_INLINE_OUTPUT_ENABLED,
});

// "Restart {Lang} and Clear All Outputs" - the title needs the active document's
// kernel language interpolated, but IMenuItem.command.title is a static string
// captured at registration. We work around it with a workbench contribution
// that re-registers the menu entry whenever the language name changes.
// MenuRegistry.appendMenuItem fires onDidChangeMenu on both add and dispose, so
// the editor action bar factory rebuilds and picks up the new title.
class QuartoRestartMenuItemController extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.quartoRestartMenuItem';

	private _menuItemDisposable: IDisposable | undefined;
	private _currentLanguageName: string | undefined;

	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@IQuartoKernelManager private readonly _kernelManager: IQuartoKernelManager,
	) {
		super();

		this._update();

		this._register(this._editorService.onDidActiveEditorChange(() => this._update()));
		this._register(this._kernelManager.onDidChangeKernelState(() => this._update()));
	}

	private _update(): void {
		const uri = this._editorService.activeEditor?.resource;
		const session = uri ? this._kernelManager.getSessionForDocument(uri) : undefined;
		const languageName = session?.runtimeMetadata.languageName;

		// Bail if the language name hasn't changed since the last registration.
		// Kernel state transitions (Ready <-> Busy) fire frequently during
		// execution but don't affect the title; precondition handles enabled
		// state separately.
		if (this._menuItemDisposable && languageName === this._currentLanguageName) {
			return;
		}
		this._currentLanguageName = languageName;

		this._menuItemDisposable?.dispose();
		this._menuItemDisposable = MenuRegistry.appendMenuItem(MenuId.PositronQuartoEditorActionBarMenu, {
			command: {
				id: QuartoCommandId.RestartAndClearAllOutputs,
				title: languageName
					? localize2(
						'quarto.editorActionBar.restartAndClearAllOutputs',
						"Restart {0} and Clear All Outputs",
						languageName)
					: localize2(
						'quarto.editorActionBar.restartAndClearAllOutputsGeneric',
						"Restart Interpreter and Clear All Outputs"),
			},
			group: '1_clear',
			order: 20,
			when: QUARTO_INLINE_OUTPUT_ENABLED,
		});
	}

	override dispose(): void {
		this._menuItemDisposable?.dispose();
		super.dispose();
	}
}

registerWorkbenchContribution2(
	QuartoRestartMenuItemController.ID,
	QuartoRestartMenuItemController,
	WorkbenchPhase.AfterRestored,
);

// --- Preview split button ---------------------------------------------------
//
// A dedicated split button for previewing the document. The primary action
// previews the document's default format; the dropdown opens the extension's
// "Preview Format..." picker, which lists the formats the document actually
// supports (the extension enumerates them with `quarto inspect`).
//
// The Quarto extension also contributes a `quarto.preview` button to
// `editor/title/run`. Both reference the same command id, and the editor action
// bar factory deduplicates by command id.
//
// The primary menu item below intentionally has no icon so the editor action
// bar factory renders the "Preview" text label rather than an icon-only button
//
// Outer submenu: the Preview split button on the editor action bar, just right
// of the Run All button.
MenuRegistry.appendMenuItem(MenuId.EditorActionsLeft, {
	submenu: MenuId.PositronQuartoPreviewMenu,
	title: localize2('quarto.editorActionBar.preview', "Preview"),
	group: 'navigation',
	order: 1,
	when: QUARTO_PREVIEW_LANG_WHEN,
	isSplitButton: true,
});

// Primary action: preview the default format.
MenuRegistry.appendMenuItem(MenuId.PositronQuartoPreviewMenu, {
	command: {
		id: 'quarto.preview',
		title: localize2('quarto.editorActionBar.preview', "Preview"),
	},
	group: 'navigation',
	order: 0,
});

// Dropdown: choose a format to preview. Delegates to the extension's
// `quarto.previewFormat`, which prompts with the document's available formats.
MenuRegistry.appendMenuItem(MenuId.PositronQuartoPreviewMenu, {
	command: {
		id: 'quarto.previewFormat',
		title: localize2('quarto.editorActionBar.previewFormat', "Preview Format..."),
	},
	group: '1_formats',
	order: 10,
});
