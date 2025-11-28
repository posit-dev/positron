/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns, local/code-amd-node-module
import React from 'react';
import { PositronModalReactRenderer } from '../../../../../../base/browser/positronModalReactRenderer.js';
import { KeyCode, KeyMod } from '../../../../../../base/common/keyCodes.js';
import { Disposable, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { EditorContextKeys } from '../../../../../../editor/common/editorContextKeys.js';
import { CONTEXT_FIND_WIDGET_VISIBLE } from '../../../../../../editor/contrib/find/browser/findModel.js';
import { localize2 } from '../../../../../../nls.js';
import { registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED } from '../../ContextKeysManager.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { NotebookAction2 } from '../../NotebookAction2.js';
import { IPositronNotebookContribution, registerPositronNotebookContribution } from '../../positronNotebookExtensions.js';
import { FindWidget } from './FindWidget.js';
import { autorun } from '../../../../../../base/common/observable.js';

/** TODO: Note that this is tied to one notebook instance lifecycle */
export class PositronNotebookFindController extends Disposable implements IPositronNotebookContribution {
	public static readonly ID = 'positron.notebook.contrib.findController';

	private readonly _renderer = this._register(new MutableDisposable<PositronModalReactRenderer>());
	// private readonly _findInstance?: FindInstance;

	constructor(
		private readonly _notebook: IPositronNotebookInstance
	) {
		super();

		autorun(reader => {
			const container = this._notebook.containerObs.read(reader);
			this._renderer.value = new PositronModalReactRenderer({
				container,
				disableCaptures: true, // permits the usage of the enter key where applicable
				onDisposed: () => {
					// activeFindWidgets.delete(container);
				}
			});
		});
	}

	public static get(notebook: IPositronNotebookInstance): PositronNotebookFindController | undefined {
		return notebook.getContribution<PositronNotebookFindController>(PositronNotebookFindController.ID);
	}

	public start(): void {
		// TODO: What if no renderer?
		const renderer = this._renderer.value;
		if (renderer) {
			const findWidget = React.createElement(FindWidget, {
				onClose: () => renderer.dispose(),
			});
			renderer.render(findWidget);
		}
	}

	public closeFindWidget(): void {
		this._renderer.dispose();
	}
}

// class FindInstance {
// 	// TODO: Who should render the find instance component?...
// }

registerPositronNotebookContribution(PositronNotebookFindController.ID, PositronNotebookFindController);

abstract class PositronNotebookFindAction extends NotebookAction2 {
	override async runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor): Promise<void> {
		const controller = PositronNotebookFindController.get(notebook);
		// controller.show(undefined, { findScope: { findScopeType: NotebookFindScopeType.None } });
		if (controller) {
			await this.runFindAction(controller);
		}
	}

	abstract runFindAction(controller: PositronNotebookFindController): Promise<void>;
}

registerAction2(class extends PositronNotebookFindAction {
	constructor() {
		super({
			id: 'positron.notebook.find',
			title: localize2('positron.notebook.find.title', 'Find in Notebook'),
			keybinding: {
				when: ContextKeyExpr.and(
					POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
					// ContextKeyExpr.or(NOTEBOOK_IS_ACTIVE_EDITOR, INTERACTIVE_WINDOW_IS_ACTIVE_EDITOR),
					EditorContextKeys.focus.toNegated()
				),
				primary: KeyCode.KeyF | KeyMod.CtrlCmd,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	override async runFindAction(controller: PositronNotebookFindController): Promise<void> {
		controller.start();
		// controller.show(undefined, { findScope: { findScopeType: NotebookFindScopeType.None } });
	}
});

registerAction2(class extends PositronNotebookFindAction {
	constructor() {
		super({
			id: 'positron.notebook.hideFind',
			title: localize2('positron.notebook.hideFind.title', 'Hide Find in Notebook'),
			keybinding: {
				when: ContextKeyExpr.and(
					POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
					CONTEXT_FIND_WIDGET_VISIBLE,
				),
				primary: KeyCode.Escape,
				weight: KeybindingWeight.EditorContrib + 5
			}
		});
	}

	override async runFindAction(controller: PositronNotebookFindController): Promise<void> {
		controller.closeFindWidget();
		// editor.focus();
	}
});
