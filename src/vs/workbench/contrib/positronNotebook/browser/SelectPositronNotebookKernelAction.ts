/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2, localize } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { selectKernelIcon } from '../../notebook/browser/notebookIcons.js';
import { INotebookKernelService, INotebookKernel } from '../../notebook/common/notebookKernelService.js';
import { PositronNotebookInstance } from './PositronNotebookInstance.js';
import { IPositronNotebookService } from '../../../services/positronNotebook/browser/positronNotebookService.js';
import { POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID } from '../../runtimeNotebookKernel/common/runtimeNotebookKernelConfig.js';

export const SELECT_KERNEL_ID_POSITRON = 'positronNotebook.selectKernel';
const NOTEBOOK_ACTIONS_CATEGORY_POSITRON = localize2('positronNotebookActions.category', 'Positron Notebook');
const NOTEBOOK_IS_ACTIVE_EDITOR = ContextKeyExpr.equals('activeEditor', 'workbench.editor.positronNotebook');

export interface SelectPositronNotebookKernelContext {
	forceDropdown: boolean;
}

class SelectPositronNotebookKernelAction extends Action2 {

	constructor() {
		super({
			id: SELECT_KERNEL_ID_POSITRON,
			category: NOTEBOOK_ACTIONS_CATEGORY_POSITRON,
			title: localize2('positronNotebookActions.selectKernel', 'Select Positron Notebook Kernel'),
			icon: selectKernelIcon,
			f1: true,
			precondition: NOTEBOOK_IS_ACTIVE_EDITOR,
		});
	}

	async run(accessor: ServicesAccessor, context?: SelectPositronNotebookKernelContext): Promise<boolean> {
		const { forceDropdown } = context || { forceDropdown: false };
		const notebookKernelService = accessor.get(INotebookKernelService);
		const notebookService = accessor.get(IPositronNotebookService);
		const activeNotebook = notebookService.getActiveInstance();
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
				k.extension.value === 'positron.positron-notebook-controllers' ||
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
