/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { IActionProvider } from '../../../../../../base/browser/ui/dropdown/dropdown.js';
import { IManagedHoverContent } from '../../../../../../base/browser/ui/hover/hover.js';
import { renderIcon, renderLabelWithIcons } from '../../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { IAction } from '../../../../../../base/common/actions.js';
import { IDisposable } from '../../../../../../base/common/lifecycle.js';
import { autorun, IObservable } from '../../../../../../base/common/observable.js';
import { localize } from '../../../../../../nls.js';
import { IActionWidgetService } from '../../../../../../platform/actionWidget/browser/actionWidget.js';
import { IActionWidgetDropdownAction, IActionWidgetDropdownActionProvider, IActionWidgetDropdownOptions } from '../../../../../../platform/actionWidget/browser/actionWidgetDropdown.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { IProductService } from '../../../../../../platform/product/common/productService.js';
import { ITelemetryService } from '../../../../../../platform/telemetry/common/telemetry.js';
import { TelemetryTrustedValue } from '../../../../../../platform/telemetry/common/telemetryUtils.js';
import { ChatEntitlement, IChatEntitlementService } from '../../../../../services/chat/common/chatEntitlementService.js';
import { MANAGE_CHAT_COMMAND_ID } from '../../../common/constants.js';
import { ILanguageModelChatMetadataAndIdentifier } from '../../../common/languageModels.js';
import { DEFAULT_MODEL_PICKER_CATEGORY } from '../../../common/widget/input/modelPickerWidget.js';
import { ChatInputPickerActionViewItem, IChatInputPickerOptions } from './chatInputPickerActionItem.js';
// --- Start Positron ---
import { getProviderIcon } from './providerIcons.js';
// --- End Positron ---

export interface IModelPickerDelegate {
	readonly currentModel: IObservable<ILanguageModelChatMetadataAndIdentifier | undefined>;
	setModel(model: ILanguageModelChatMetadataAndIdentifier): void;
	getModels(): ILanguageModelChatMetadataAndIdentifier[];
}

type ChatModelChangeClassification = {
	owner: 'lramos15';
	comment: 'Reporting when the model picker is switched';
	fromModel?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The previous chat model' };
	toModel: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The new chat model' };
};

type ChatModelChangeEvent = {
	fromModel: string | TelemetryTrustedValue<string> | undefined;
	toModel: string | TelemetryTrustedValue<string>;
};


function modelDelegateToWidgetActionsProvider(delegate: IModelPickerDelegate, telemetryService: ITelemetryService, pickerOptions: IChatInputPickerOptions): IActionWidgetDropdownActionProvider {
	// --- Start Positron ---
	// The entire body of this function has been replaced to group models by
	// vendor with separators, and to indicate default models in the list.
	return {
		getActions: () => {
			const models = delegate.getModels();
			const actions: IActionWidgetDropdownAction[] = [];

			// --- Start CodeOSS ---
			if (models.length === 0) {
				// Show a fake "Auto" entry when no models are available
				return [{
					id: 'auto',
					enabled: true,
					checked: true,
					category: DEFAULT_MODEL_PICKER_CATEGORY,
					class: undefined,
					description: localize('chat.modelPicker.auto.detail', "Best for your request based on capacity and performance."),
					tooltip: localize('chat.modelPicker.auto', "Auto"),
					label: localize('chat.modelPicker.auto', "Auto"),
					hover: { content: localize('chat.modelPicker.auto.description', "Automatically selects the best model for your task based on context and complexity."), position: pickerOptions.hoverPosition },
					run: () => { }
				} satisfies IActionWidgetDropdownAction];
			}
			// --- End CodeOSS ---

			// Group models by vendor
			const modelsByVendor = new Map<string, typeof models>();
			for (const model of models) {
				const vendor = model.metadata.vendor;
				if (!modelsByVendor.has(vendor)) {
					modelsByVendor.set(vendor, []);
				}
				modelsByVendor.get(vendor)!.push(model);
			}

			// Sort each vendor's models to place the default model first
			// This improves UX by making the default model immediately visible
			// without scrolling, especially for providers with long model lists
			for (const [vendor, vendorModels] of modelsByVendor.entries()) {
				// Find the default model for this vendor
				// Check if model is default for any location
				const defaultModel = vendorModels.find(m => {
					const isDefaultForLocation = m.metadata.isDefaultForLocation;
					return isDefaultForLocation && Object.values(isDefaultForLocation).some(v => v);
				});

				if (defaultModel) {
					// Separate default from non-default models
					const nonDefaultModels = vendorModels.filter(m => {
						const isDefaultForLocation = m.metadata.isDefaultForLocation;
						return !(isDefaultForLocation && Object.values(isDefaultForLocation).some(v => v));
					});

					// Place default first, followed by remaining models in original order
					modelsByVendor.set(vendor, [defaultModel, ...nonDefaultModels]);
				}
				// If no default, keep original order
			}

			// Sort vendors for consistent ordering
			const sortedVendors = Array.from(modelsByVendor.entries())
				.sort((a, b) => {
					// Prioritize Copilot, then alphabetically
					if (a[0] === 'copilot') { return -1; }
					if (b[0] === 'copilot') { return 1; }
					return a[0].localeCompare(b[0]);
				});

			let vendorOrder = 0;
			for (const [vendor, vendorModels] of sortedVendors) {
				// Add separator with provider name before each group
				// Get provider display name from the first model in the group
				const firstModel = vendorModels[0];
				const providerName = firstModel.metadata.auth?.providerLabel ?? vendor;

				// Get provider icon based on vendor ID
				const providerIcon = getProviderIcon(vendor);

				// Use a special category prefix to indicate this is a separator
				actions.push({
					id: `separator-${vendor}`,
					label: providerName,
					enabled: false,
					checked: false,
					class: undefined,
					tooltip: '',
					icon: providerIcon?.themeIcon,
					category: { label: `__separator_${vendor}`, order: vendorOrder * 1000 - 1 },
					hover: undefined,
					run: () => { /* separator - no action */ }
				} satisfies IActionWidgetDropdownAction);

				// Add all models for this vendor
				for (const model of vendorModels) {
					// Check if this model is marked as the default for its provider
					// Check if model is default for any location
					const isDefaultForLocation = model.metadata.isDefaultForLocation;
					const isDefault = isDefaultForLocation && Object.values(isDefaultForLocation).some(v => v);
					// Add "(default)" suffix to label if this is the default model
					const label = isDefault ? `${model.metadata.name} (default)` : model.metadata.name;
					// Add "(default)" to tooltip if this is the default model
					const tooltip = isDefault
						? localize('chat.defaultModel', "{0} (default)", model.metadata.tooltip ?? model.metadata.name)
						: (model.metadata.tooltip ?? model.metadata.name);
					const hoverContent = model.metadata.tooltip;

					actions.push({
						id: model.metadata.id,
						enabled: true,
						icon: model.metadata.statusIcon,
						checked: model.identifier === delegate.currentModel.get()?.identifier,
						category: { label: `vendor_${vendor}`, order: vendorOrder * 1000 },
						class: undefined,
						description: model.metadata.multiplier ?? model.metadata.detail,
						tooltip: tooltip,
						hover: hoverContent ? { content: hoverContent, position: pickerOptions.hoverPosition } : undefined,
						label: label,
						run: () => {
							const previousModel = delegate.currentModel.get();
							telemetryService.publicLog2<ChatModelChangeEvent, ChatModelChangeClassification>('chat.modelChange', {
								fromModel: previousModel?.metadata.vendor === 'copilot' ? new TelemetryTrustedValue(previousModel.identifier) : 'unknown',
								toModel: model.metadata.vendor === 'copilot' ? new TelemetryTrustedValue(model.identifier) : 'unknown'
							});
							delegate.setModel(model);
						}
					} satisfies IActionWidgetDropdownAction);
				}

				vendorOrder++;
			}

			return actions;
		}
	};
	// --- End Positron ---
}

function getModelPickerActionBarActionProvider(commandService: ICommandService, chatEntitlementService: IChatEntitlementService, productService: IProductService): IActionProvider {

	const actionProvider: IActionProvider = {
		getActions: () => {
			const additionalActions: IAction[] = [];
			// --- Start Positron ---
			// Override the entitlement check to always show manage models option
			const useManageModelsAction = true;
			if (
				useManageModelsAction ||
				// --- End Positron ---
				chatEntitlementService.entitlement === ChatEntitlement.Free ||
				chatEntitlementService.entitlement === ChatEntitlement.Pro ||
				chatEntitlementService.entitlement === ChatEntitlement.ProPlus ||
				chatEntitlementService.entitlement === ChatEntitlement.Business ||
				chatEntitlementService.entitlement === ChatEntitlement.Enterprise ||
				chatEntitlementService.isInternal
			) {
				additionalActions.push({
					id: 'manageModels',
					label: localize('chat.manageModels', "Manage Models..."),
					enabled: true,
					tooltip: localize('chat.manageModels.tooltip', "Manage Language Models"),
					class: undefined,
					run: () => {
						commandService.executeCommand(MANAGE_CHAT_COMMAND_ID);
					}
				});
			}

			// Add sign-in / upgrade option if entitlement is anonymous / free / new user
			const isNewOrAnonymousUser = !chatEntitlementService.sentiment.installed ||
				chatEntitlementService.entitlement === ChatEntitlement.Available ||
				chatEntitlementService.anonymous ||
				chatEntitlementService.entitlement === ChatEntitlement.Unknown;
			if (isNewOrAnonymousUser || chatEntitlementService.entitlement === ChatEntitlement.Free) {
				additionalActions.push({
					id: 'moreModels',
					label: isNewOrAnonymousUser ? localize('chat.moreModels', "Add Language Models") : localize('chat.morePremiumModels', "Add Premium Models"),
					enabled: true,
					tooltip: isNewOrAnonymousUser ? localize('chat.moreModels.tooltip', "Add Language Models") : localize('chat.morePremiumModels.tooltip', "Add Premium Models"),
					class: undefined,
					run: () => {
						const commandId = isNewOrAnonymousUser ? 'workbench.action.chat.triggerSetup' : 'workbench.action.chat.upgradePlan';
						commandService.executeCommand(commandId);
					}
				});
			}

			// --- Start Positron ---
			// Remove the moreModels action and add configureProviders action instead
			const moreModelsIndex = additionalActions.findIndex(action => action.id === 'moreModels');
			if (moreModelsIndex !== -1) {
				additionalActions.splice(moreModelsIndex, 1);
			}
			additionalActions.push({
				id: 'configureProviders',
				label: localize('chat.configureProviders', "Configure Model Providers..."),
				enabled: true,
				tooltip: localize('chat.configureProviders.tooltip', "Add and Configure Language Model Providers"),
				class: undefined,
				run: () => {
					const commandId = 'positron-assistant.configureModels';
					commandService.executeCommand(commandId);
				}
			});
			// --- End Positron ---

			return additionalActions;
		}
	};
	return actionProvider;
}

/**
 * Action view item for selecting a language model in the chat interface.
 */
export class ModelPickerActionItem extends ChatInputPickerActionViewItem {
	protected currentModel: ILanguageModelChatMetadataAndIdentifier | undefined;

	constructor(
		action: IAction,
		widgetOptions: Omit<IActionWidgetDropdownOptions, 'label' | 'labelRenderer'> | undefined,
		delegate: IModelPickerDelegate,
		pickerOptions: IChatInputPickerOptions,
		@IActionWidgetService actionWidgetService: IActionWidgetService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICommandService commandService: ICommandService,
		@IChatEntitlementService chatEntitlementService: IChatEntitlementService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IProductService productService: IProductService,
	) {
		// Modify the original action with a different label and make it show the current model
		const actionWithLabel: IAction = {
			...action,
			label: delegate.currentModel.get()?.metadata.name ?? localize('chat.modelPicker.auto', "Auto"),
			run: () => { }
		};

		const modelPickerActionWidgetOptions: Omit<IActionWidgetDropdownOptions, 'label' | 'labelRenderer'> = {
			actionProvider: modelDelegateToWidgetActionsProvider(delegate, telemetryService, pickerOptions),
			actionBarActionProvider: getModelPickerActionBarActionProvider(commandService, chatEntitlementService, productService),
			reporter: { name: 'ChatModelPicker', includeOptions: true },
		};

		super(actionWithLabel, widgetOptions ?? modelPickerActionWidgetOptions, pickerOptions, actionWidgetService, keybindingService, contextKeyService, telemetryService);
		this.currentModel = delegate.currentModel.get();

		// Listen for model changes from the delegate
		this._register(autorun(t => {
			const model = delegate.currentModel.read(t);
			this.currentModel = model;
			this.updateTooltip();
			if (this.element) {
				this.renderLabel(this.element);
			}
		}));
	}

	protected override getHoverContents(): IManagedHoverContent | undefined {
		const label = `${localize('chat.modelPicker.label', "Pick Model")}${super.getHoverContents()}`;
		const { statusIcon, tooltip } = this.currentModel?.metadata || {};
		return statusIcon && tooltip ? `${label} • ${tooltip}` : label;
	}

	protected override setAriaLabelAttributes(element: HTMLElement): void {
		super.setAriaLabelAttributes(element);
		const modelName = this.currentModel?.metadata.name ?? localize('chat.modelPicker.auto', "Auto");
		element.ariaLabel = localize('chat.modelPicker.ariaLabel', "Pick Model, {0}", modelName);
	}

	protected override renderLabel(element: HTMLElement): IDisposable | null {
		const { name, statusIcon } = this.currentModel?.metadata || {};
		const domChildren = [];
		// --- Start Positron ---
		// Add provider icon if available
		if (this.currentModel?.metadata.vendor) {
			const providerIcon = getProviderIcon(this.currentModel.metadata.vendor);
			if (providerIcon?.themeIcon) {
				const iconId = providerIcon.themeIcon.id;
				if (iconId.startsWith('data:image/svg+xml')) {
					// Render SVG as background image
					const iconElement = dom.$('span.provider-icon');
					iconElement.style.backgroundImage = `url('${iconId}')`;
					domChildren.push(iconElement);
				} else {
					// Regular codicon
					domChildren.push(...renderLabelWithIcons(`\$(${iconId})`));
				}
			}
		}
		// --- End Positron ---

		if (statusIcon) {
			const iconElement = renderIcon(statusIcon);
			domChildren.push(iconElement);
		}

		domChildren.push(dom.$('span.chat-input-picker-label', undefined, name ?? localize('chat.modelPicker.auto', "Auto")));
		domChildren.push(...renderLabelWithIcons(`$(chevron-down)`));

		dom.reset(element, ...domChildren);
		this.setAriaLabelAttributes(element);
		return null;
	}

}
