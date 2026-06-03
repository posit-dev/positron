/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IQuickInputService, IQuickPickItem, QuickPickInput } from '../../../../platform/quickinput/common/quickInput.js';
import { IAvailableModel } from '../common/positronLMService.js';

interface IModelPickItem extends IQuickPickItem {
	model?: IAvailableModel;
	isDefault?: boolean;
}

export interface ModelPickerResultModel {
	kind: 'model';
	model: IAvailableModel;
}

export interface ModelPickerResultDefault {
	kind: 'default';
}

/**
 * The result of showing the model picker.
 * - `{ kind: 'model', model }` -- user selected a specific model
 * - `{ kind: 'default' }` -- user chose to use the default tier
 * - `undefined` -- user cancelled
 */
export type ModelPickerSelection = ModelPickerResultModel | ModelPickerResultDefault | undefined;

/**
 * Show a QuickPick for selecting an LM model from the available models.
 * Groups models by provider. Returns the user's selection without persisting it.
 *
 * @param quickInputService The quick input service for showing the picker
 * @param availableModels Snapshot of models to display (from IPositronLMService.availableModels)
 * @param title Title shown at the top of the picker (e.g., "Select Model for Ghost Cell Suggestions")
 * @param currentModelId If a model is currently pinned, its ID. Shows the "Use Default" option
 *   and marks the pinned model as active. When no model is pinned (undefined), the "Use Default"
 *   option is hidden since the caller is already using the default.
 */
export async function showModelPicker(
	quickInputService: IQuickInputService,
	availableModels: IAvailableModel[],
	title: string,
	currentModelId?: string,
): Promise<ModelPickerSelection> {
	const disposables = new DisposableStore();
	const picker = disposables.add(
		quickInputService.createQuickPick<IModelPickItem>({ useSeparators: true })
	);

	picker.title = title;
	picker.placeholder = currentModelId
		? localize('positron.modelPicker.placeholderPinned', "Choose a model or use default auto-selection")
		: localize('positron.modelPicker.placeholder', "Choose a model to pin");
	picker.matchOnDescription = true;
	picker.matchOnDetail = true;

	const items: QuickPickInput<IModelPickItem>[] = [];
	let activeItem: IModelPickItem | undefined;

	// "Use Default" option shown only when a model is currently pinned.
	// When nothing is pinned, the caller is already on the default -- no need to offer it.
	if (currentModelId) {
		items.push({
			label: localize('positron.modelPicker.useDefault', "Use Default (Auto-select)"),
			description: localize('positron.modelPicker.useDefaultDescription', "Automatically selects a fast model (Haiku, Mini, etc.)"),
			isDefault: true,
		});
	}

	// Group models by provider
	let lastProvider: string | undefined;
	for (const model of availableModels) {
		if (model.providerName !== lastProvider) {
			items.push({ type: 'separator', label: model.providerName });
			lastProvider = model.providerName;
		}

		const item: IModelPickItem = {
			label: model.name,
			description: model.id === currentModelId ? localize('positron.modelPicker.current', "(current)") : undefined,
			detail: model.id,
			model,
		};

		if (model.id === currentModelId) {
			activeItem = item;
		}

		items.push(item);
	}

	picker.items = items;

	if (activeItem) {
		picker.activeItems = [activeItem];
	}

	picker.show();

	const result = await new Promise<ModelPickerSelection>(resolve => {
		disposables.add(picker.onDidAccept(() => {
			const selected = picker.selectedItems[0];
			if (!selected) {
				resolve(undefined);
			} else if (selected.isDefault) {
				resolve({ kind: 'default' });
			} else if (selected.model) {
				resolve({ kind: 'model', model: selected.model });
			} else {
				resolve(undefined);
			}
			picker.hide();
		}));

		disposables.add(Event.once(picker.onDidHide)(() => {
			resolve(undefined);
		}));
	});

	disposables.dispose();
	return result;
}
