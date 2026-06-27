/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { groupByMap } from '../../../../base/common/collections.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IQuickInputService, IQuickPickItem, QuickPickInput } from '../../../../platform/quickinput/common/quickInput.js';
import { IHeadlessLanguageModelService } from '../common/headlessLanguageModelService.js';

/** Options for {@link showHeadlessModelPicker}. */
export interface IHeadlessModelPickerOptions {
	/** The setting a consumer stores its model choice in. */
	readonly settingKey: string;
	/** The quick-pick title. */
	readonly title: string;
}

interface IModelPickItem extends IQuickPickItem {
	readonly modelId?: string;
	readonly useDefault?: boolean;
}

/**
 * A consistent, reusable model picker: "use the default" plus the
 * available models grouped by vendor. Writes the choice to the consumer's
 * setting -- a pinned model id, or cleared to fall back to the default tier.
 *
 * Built on the service's public surface (`getAvailableModels`) so every feature
 * offers the same experience.
 */
export async function showHeadlessModelPicker(
	service: IHeadlessLanguageModelService,
	quickInputService: IQuickInputService,
	configurationService: IConfigurationService,
	options: IHeadlessModelPickerOptions,
): Promise<void> {
	const models = await service.getAvailableModels();

	const configured = configurationService.getValue<string[]>(options.settingKey);
	const usingDefault = !configured || configured.length === 0;
	const pinnedId = configured && configured.length === 1 ? configured[0] : undefined;
	const current = localize('positron.headlessModelPicker.current', "Current");

	const items: QuickPickInput<IModelPickItem>[] = [{
		label: localize('positron.headlessModelPicker.useDefault', "Use Default (fast/cheap)"),
		description: usingDefault ? current : undefined,
		useDefault: true,
	}];

	const byVendor = groupByMap([...models], model => model.vendor);
	for (const vendor of [...byVendor.keys()].sort()) {
		items.push({ type: 'separator', label: vendor });
		for (const model of byVendor.get(vendor) ?? []) {
			items.push({
				label: model.name,
				description: pinnedId === model.id ? current : undefined,
				detail: model.id,
				modelId: model.id,
			});
		}
	}

	const placeHolder = models.length === 0
		? localize('positron.headlessModelPicker.noModels', "No models available -- sign in to a provider, or use the default.")
		: localize('positron.headlessModelPicker.placeholder', "Choose a model, or use the default.");

	const picked = await quickInputService.pick(items, { title: options.title, placeHolder, matchOnDetail: true });
	if (!picked) {
		return; // cancelled
	}

	if (picked.useDefault) {
		// Clear the user value so the consumer falls back to the default tier.
		await configurationService.updateValue(options.settingKey, undefined);
	} else if (picked.modelId) {
		await configurationService.updateValue(options.settingKey, [picked.modelId]);
	}
}
