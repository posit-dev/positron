/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2, localize } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { INotebookKernelService, INotebookKernel } from '../../notebook/common/notebookKernelService.js';
import { PositronNotebookInstance } from './PositronNotebookInstance.js';
import { POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID } from '../../runtimeNotebookKernel/common/runtimeNotebookKernelConfig.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromActiveEditorPane } from './notebookUtils.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IPositronNotebookActionBarContext } from '../../runtimeNotebookKernel/browser/runtimeNotebookKernelActions.js';

export const SELECT_KERNEL_ID_POSITRON = 'positronNotebook.selectKernel';
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

	async run(accessor: ServicesAccessor, context?: IPositronNotebookActionBarContext): Promise<boolean> {
		// Force the dropdown if the action was invoked by the user in the UI
		const forceDropdown = context?.ui ?? false;
		const notebookKernelService = accessor.get(INotebookKernelService);
		const activeNotebook = getNotebookInstanceFromActiveEditorPane(accessor.get(IEditorService));
		const quickInputService = accessor.get(IQuickInputService);

		if (!activeNotebook) {
			return false;
		}

		const notebook = (activeNotebook as PositronNotebookInstance).textModel;
		if (!notebook) {
			return false;
		}

		const kernelMatches = notebookKernelService.getMatchingKernel(notebook);

		if (!forceDropdown && kernelMatches.selected) {
			// current kernel is wanted kernel -> done
			return true;
		}

		// Show quick-pick with all kernels that match notebook, aka positronKernels
		const quickPick = quickInputService.createQuickPick<IQuickPickItem & { kernel?: INotebookKernel }>();
		quickPick.title = localize('positronNotebookActions.selectKernel.title', 'Select Positron Notebook Kernel');

		const gatherKernelPicks = () => {
			const kernelMatches = notebookKernelService.getMatchingKernel(notebook);
			const positronKernels = kernelMatches.all.filter(k =>
				k.extension.value === POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID);
			if (positronKernels.length === 0) {
				quickPick.busy = true;
				quickPick.items = [{ label: localize('positronNotebookActions.selectKernel.noKernel', 'No Positron Notebook Kernel found'), picked: true }];
			} else {
				quickPick.busy = false;
				quickPick.items = positronKernels.map(kernel => ({
					label: kernel.label,
					description: kernel.description,
					kernel,
					picked: kernelMatches.selected?.id === kernel.id
				}));
			}
		};

		// Watch for new kernels being added so we can update the quick-pick
		notebookKernelService.onDidAddKernel(gatherKernelPicks);

		gatherKernelPicks();

		return new Promise<boolean>(resolve => {
			let didSelectKernel: boolean = false;
			quickPick.onDidAccept(() => {
				const selectedKernel = quickPick.selectedItems[0].kernel;
				if (selectedKernel) {
					// Link kernel with notebook
					notebookKernelService.selectKernelForNotebook(selectedKernel, notebook);
					didSelectKernel = true;
				}
				quickPick.hide();
				quickPick.dispose();
				resolve(true);
			});

			quickPick.show();

			quickPick.onDidHide(() => {
				quickPick.dispose();
				resolve(didSelectKernel);
			});
		});
	}
}
registerAction2(SelectPositronNotebookKernelAction);
