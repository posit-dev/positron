/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotebookKernelService } from '../../notebook/common/notebookKernelService.js';
import { POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID } from '../../runtimeNotebookKernel/common/runtimeNotebookKernelConfig.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromActiveEditorPane } from './notebookUtils.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { selectNewLanguageRuntime } from '../../languageRuntime/browser/languageRuntimeActions.js';
import { SELECT_KERNEL_ID_POSITRON } from '../common/positronNotebookCommon.js';

const NOTEBOOK_ACTIONS_CATEGORY_POSITRON = localize2('positronNotebookActions.category', 'Positron Notebook');
const NOTEBOOK_IS_ACTIVE_EDITOR = ContextKeyExpr.equals('activeEditor', 'workbench.editor.positronNotebook');

class SelectPositronNotebookKernelAction extends Action2 {

	constructor() {
		super({
			id: SELECT_KERNEL_ID_POSITRON,
			category: NOTEBOOK_ACTIONS_CATEGORY_POSITRON,
			title: localize2('positronNotebookActions.changeKernel', 'Change Kernel...'),
			icon: Codicon.gear,
			f1: true,
			precondition: NOTEBOOK_IS_ACTIVE_EDITOR,
			menu: [{
				id: MenuId.PositronNotebookKernelSubmenu,
				order: 0,
			}]
		});
	}

	async run(accessor: ServicesAccessor): Promise<boolean> {
		const notebookKernelService = accessor.get(INotebookKernelService);
		const activeNotebook = getNotebookInstanceFromActiveEditorPane(accessor.get(IEditorService));

		if (!activeNotebook) {
			return false;
		}

		const notebook = activeNotebook.textModel;
		if (!notebook) {
			return false;
		}

		const selectedKernel = notebookKernelService.getMatchingKernel(notebook).selected;
		const currentRuntimeId = selectedKernel?.extension.value === POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID
			? selectedKernel.id.slice(POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID.length + 1)
			: undefined;

		const runtime = await selectNewLanguageRuntime(accessor, {
			title: localize('positronNotebookActions.selectKernel.title', 'Select Positron Notebook Kernel'),
			currentRuntimeId,
		});

		if (!runtime) {
			return false;
		}

		const kernel = notebookKernelService.getMatchingKernel(notebook).all.find(
			k => k.id === `${POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID}/${runtime.runtimeId}`
		);
		if (!kernel) {
			return false;
		}

		notebookKernelService.selectKernelForNotebook(kernel, notebook);
		activeNotebook.focus();
		return true;
	}
}
registerAction2(SelectPositronNotebookKernelAction);
