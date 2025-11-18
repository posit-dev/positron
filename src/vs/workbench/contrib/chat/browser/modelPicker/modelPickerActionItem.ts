/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction } from '../../../../../base/common/actions.js';
import { Event } from '../../../../../base/common/event.js';
import { ILanguageModelChatMetadataAndIdentifier } from '../../common/languageModels.js';
import { localize } from '../../../../../nls.js';
import * as dom from '../../../../../base/browser/dom.js';
import { renderLabelWithIcons } from '../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { ActionWidgetDropdownActionViewItem } from '../../../../../platform/actions/browser/actionWidgetDropdownActionViewItem.js';
import { IActionWidgetService } from '../../../../../platform/actionWidget/browser/actionWidget.js';
import { IActionWidgetDropdownAction, IActionWidgetDropdownActionProvider, IActionWidgetDropdownOptions } from '../../../../../platform/actionWidget/browser/actionWidgetDropdown.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ChatEntitlement, IChatEntitlementService } from '../../../../services/chat/common/chatEntitlementService.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
// --- Start Positron ---
// Unused import removed
// import { DEFAULT_MODEL_PICKER_CATEGORY } from '../../common/modelPicker/modelPickerWidget.js';
// --- End Positron ---
import { ManageModelsAction } from '../actions/manageModelsActions.js';
import { IActionProvider } from '../../../../../base/browser/ui/dropdown/dropdown.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { MANAGE_CHAT_COMMAND_ID } from '../../common/constants.js';
import { TelemetryTrustedValue } from '../../../../../platform/telemetry/common/telemetryUtils.js';

// --- Start Positron ---
import { getProviderIcon } from './providerIcons.js';
// --- End Positron ---

export interface IModelPickerDelegate {
	readonly onDidChangeModel: Event<ILanguageModelChatMetadataAndIdentifier>;
	getCurrentModel(): ILanguageModelChatMetadataAndIdentifier | undefined;
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

function modelDelegateToWidgetActionsProvider(delegate: IModelPickerDelegate, telemetryService: ITelemetryService): IActionWidgetDropdownActionProvider {
	// --- Start Positron ---
	// The entire body of this function has been replaced to group models by
	// vendor with separators
	return {
		getActions: () => {
			const models = delegate.getModels();
			const actions: IActionWidgetDropdownAction[] = [];

			// Group models by vendor
			const modelsByVendor = new Map<string, typeof models>();
			for (const model of models) {
				const vendor = model.metadata.vendor;
				if (!modelsByVendor.has(vendor)) {
					modelsByVendor.set(vendor, []);
				}
				modelsByVendor.get(vendor)!.push(model);
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
				const providerName = firstModel.metadata.auth?.providerLabel ??
					firstModel.metadata.providerName ??
					vendor;

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
					run: () => { /* separator - no action */ }
				} satisfies IActionWidgetDropdownAction);				// Add all models for this vendor
				for (const model of vendorModels) {
					actions.push({
						id: model.metadata.id,
						enabled: true,
						icon: model.metadata.statusIcon,
						checked: model.identifier === delegate.getCurrentModel()?.identifier,
						category: { label: `vendor_${vendor}`, order: vendorOrder * 1000 },
						class: undefined,
						description: model.metadata.detail,
						tooltip: model.metadata.tooltip ?? model.metadata.name,
						label: model.metadata.name,
						run: () => {
							const previousModel = delegate.getCurrentModel();
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
			// override the entitlement check to always show manage models option
			const useManageModelsAction = true;
			if (
				useManageModelsAction ||
				// --- End Positron ---
				chatEntitlementService.entitlement === ChatEntitlement.Free ||
				chatEntitlementService.entitlement === ChatEntitlement.Pro ||
				chatEntitlementService.entitlement === ChatEntitlement.ProPlus ||
				chatEntitlementService.isInternal
			) {
				additionalActions.push({
					id: 'manageModels',
					label: localize('chat.manageModels', "Manage Models..."),
					enabled: true,
					tooltip: localize('chat.manageModels.tooltip', "Manage Language Models"),
					class: undefined,
					run: () => {
						const commandId = ManageModelsAction.ID;
						commandService.executeCommand(productService.quality === 'stable' ? commandId : MANAGE_CHAT_COMMAND_ID);
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
				label: localize('chat.configureProviders', "Configure Model Providers"),
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
export class ModelPickerActionItem extends ActionWidgetDropdownActionViewItem {
	constructor(
		action: IAction,
		protected currentModel: ILanguageModelChatMetadataAndIdentifier | undefined,
		widgetOptions: Omit<IActionWidgetDropdownOptions, 'label' | 'labelRenderer'> | undefined,
		delegate: IModelPickerDelegate,
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
			label: currentModel?.metadata.name ?? localize('chat.modelPicker.label', "Pick Model"),
			tooltip: localize('chat.modelPicker.label', "Pick Model"),
			run: () => { }
		};

		const modelPickerActionWidgetOptions: Omit<IActionWidgetDropdownOptions, 'label' | 'labelRenderer'> = {
			actionProvider: modelDelegateToWidgetActionsProvider(delegate, telemetryService),
			actionBarActionProvider: getModelPickerActionBarActionProvider(commandService, chatEntitlementService, productService)
		};

		super(actionWithLabel, widgetOptions ?? modelPickerActionWidgetOptions, actionWidgetService, keybindingService, contextKeyService);

		// Listen for model changes from the delegate
		this._register(delegate.onDidChangeModel(model => {
			this.currentModel = model;
			if (this.element) {
				this.renderLabel(this.element);
			}
		}));
	}

	protected override renderLabel(element: HTMLElement): IDisposable | null {
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

		if (this.currentModel?.metadata.statusIcon) {
			domChildren.push(...renderLabelWithIcons(`\$(${this.currentModel.metadata.statusIcon.id})`));
		}
		domChildren.push(dom.$('span.chat-model-label', undefined, this.currentModel?.metadata.name ?? localize('chat.modelPicker.label', "Pick Model")));
		domChildren.push(...renderLabelWithIcons(`$(chevron-down)`));

		dom.reset(element, ...domChildren);
		this.setAriaLabelAttributes(element);
		return null;
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('chat-modelPicker-item');
	}
}
