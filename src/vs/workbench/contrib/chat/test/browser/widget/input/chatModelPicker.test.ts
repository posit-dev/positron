/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { IStringDictionary } from '../../../../../../../base/common/collections.js';
import { MarkdownString } from '../../../../../../../base/common/htmlContent.js';
import { ActionListItemKind, IActionListItem } from '../../../../../../../platform/actionWidget/browser/actionList.js';
import { IActionWidgetDropdownAction } from '../../../../../../../platform/actionWidget/browser/actionWidgetDropdown.js';
import { ICommandService } from '../../../../../../../platform/commands/common/commands.js';
import { StateType } from '../../../../../../../platform/update/common/update.js';
import { buildModelPickerItems, getModelPickerAccessibilityProvider } from '../../../../browser/widget/input/chatModelPicker.js';
import { ILanguageModelChatMetadata, ILanguageModelChatMetadataAndIdentifier, IModelControlEntry } from '../../../../common/languageModels.js';
import { ChatEntitlement, IChatEntitlementService } from '../../../../../../services/chat/common/chatEntitlementService.js';

function createStubEntitlementService(opts?: { entitlement?: ChatEntitlement; isInternal?: boolean; anonymous?: boolean }): IChatEntitlementService {
	return {
		entitlement: opts?.entitlement ?? ChatEntitlement.Pro,
		sentiment: { installed: true } as IChatEntitlementService['sentiment'],
		isInternal: opts?.isInternal ?? false,
		anonymous: opts?.anonymous ?? false,
	} as IChatEntitlementService;
}

const stubChatEntitlementService = createStubEntitlementService();

function createModel(id: string, name: string, vendor = 'copilot'): ILanguageModelChatMetadataAndIdentifier {
	return {
		identifier: `${vendor}-${id}`,
		metadata: {
			id,
			name,
			vendor,
			version: id,
			family: vendor,
			maxInputTokens: 128000,
			maxOutputTokens: 4096,
			isDefaultForLocation: {},
			modelPickerCategory: undefined,
		} as ILanguageModelChatMetadata,
	};
}

function createAutoModel(): ILanguageModelChatMetadataAndIdentifier {
	return createModel('auto', 'Auto', 'copilot');
}

const stubCommandService: ICommandService = {
	_serviceBrand: undefined,
	onWillExecuteCommand: () => ({ dispose() { } }),
	onDidExecuteCommand: () => ({ dispose() { } }),
	executeCommand: () => Promise.resolve(undefined),
};

function getActionItems(items: IActionListItem<IActionWidgetDropdownAction>[]): IActionListItem<IActionWidgetDropdownAction>[] {
	return items.filter(i => i.kind === ActionListItemKind.Action);
}

function getActionLabels(items: IActionListItem<IActionWidgetDropdownAction>[]): string[] {
	return getActionItems(items).map(i => i.label!);
}

function getSeparatorCount(items: IActionListItem<IActionWidgetDropdownAction>[]): number {
	return items.filter(i => i.kind === ActionListItemKind.Separator).length;
}

function callBuild(
	models: ILanguageModelChatMetadataAndIdentifier[],
	opts: {
		selectedModelId?: string;
		recentModelIds?: string[];
		controlModels?: IStringDictionary<IModelControlEntry>;
		entitlement?: ChatEntitlement;
		currentVSCodeVersion?: string;
		updateStateType?: StateType;
		manageSettingsUrl?: string;
		anonymous?: boolean;
	} = {},
): IActionListItem<IActionWidgetDropdownAction>[] {
	const onSelect = () => { };
	const entitlementService = createStubEntitlementService({
		entitlement: opts.entitlement ?? ChatEntitlement.Pro,
		anonymous: opts.anonymous ?? false,
	});
	return buildModelPickerItems(
		models,
		opts.selectedModelId,
		opts.recentModelIds ?? [],
		opts.controlModels ?? {},
		opts.currentVSCodeVersion ?? '1.100.0',
		opts.updateStateType ?? StateType.Idle,
		onSelect,
		opts.manageSettingsUrl,
		true,
		stubCommandService,
		entitlementService,
	);
}

suite('buildModelPickerItems', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('accessibility provider uses radio semantics for model items', () => {
		const provider = getModelPickerAccessibilityProvider();
		assert.strictEqual(provider.getRole({ kind: ActionListItemKind.Action } as IActionListItem<IActionWidgetDropdownAction>), 'menuitemradio');
		assert.strictEqual(provider.getRole({ kind: ActionListItemKind.Separator } as IActionListItem<IActionWidgetDropdownAction>), 'separator');
		assert.strictEqual(provider.getWidgetRole(), 'menu');
	});

	test('auto model always appears first', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const items = callBuild([modelA, auto]);
		const actions = getActionItems(items);
		// --- Start Positron ---
		// In Positron, Auto is not promoted to first position - it appears grouped with other models by provider
		assert.ok(actions[0].label === 'Other Models');
		assert.ok(actions[1].label === 'Auto');
		// --- End Positron ---
	});

	test('empty models list produces auto and manage models entries', () => {
		const items = callBuild([]);
		const actions = getActionItems(items);
		// --- Start Positron ---
		// Positron adds additional footer items and Auto is not promoted to first position
		assert.ok(actions[0].label === 'Auto');
		// --- End Positron ---
	});

	test('only auto model produces auto and manage models with separator', () => {
		const items = callBuild([createAutoModel()]);
		const actions = getActionItems(items);
		// --- Start Positron ---
		// In Positron: Other Models toggle, Auto, then footer items
		assert.strictEqual(actions[0].label, 'Other Models');
		assert.strictEqual(actions[0].isSectionToggle, true);
		assert.strictEqual(actions[1].label, 'Auto');
		assert.strictEqual(actions[2].item?.id, 'manageModels');
		assert.strictEqual(actions[3].item?.id, 'configureProviders');
		assert.ok(getSeparatorCount(items) >= 2);
		// --- End Positron ---
	});

	test('selected model appears in promoted section', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const modelB = createModel('claude', 'Claude');
		const items = callBuild([auto, modelA, modelB], {
			selectedModelId: modelA.identifier,
		});
		const actions = getActionItems(items);
		// --- Start Positron ---
		// In Positron: selected model in promoted, then Other Models toggle, then remaining models
		assert.strictEqual(actions[0].label, 'GPT-4o');
		assert.ok(actions[0].item?.checked);
		assert.strictEqual(actions[1].label, 'Other Models');
		assert.strictEqual(actions[1].isSectionToggle, true);
		// Auto and Claude in Other Models section (sorted alphabetically)
		assert.strictEqual(actions[2].label, 'Auto');
		assert.strictEqual(actions[3].label, 'Claude');
		// --- End Positron ---
	});

	test('selected model with failing minVSCodeVersion shows as unavailable with reason update', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const items = callBuild([auto, modelA], {
			selectedModelId: modelA.identifier,
			controlModels: {
				'gpt-4o': { label: 'GPT-4o', minVSCodeVersion: '2.0.0', exists: true },
			},
			currentVSCodeVersion: '1.90.0',
		});
		const actions = getActionItems(items);
		// The promoted section should contain the unavailable model
		const promotedItem = actions.find(a => a.label === 'GPT-4o');
		assert.ok(promotedItem);
		assert.strictEqual(promotedItem.disabled, true);
		assert.strictEqual(promotedItem.item?.enabled, false);
	});

	test('recently used models appear in promoted section', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const modelB = createModel('claude', 'Claude');
		const modelC = createModel('gemini', 'Gemini');
		const items = callBuild([auto, modelA, modelB, modelC], {
			recentModelIds: [modelB.identifier],
		});
		const actions = getActionItems(items);
		// --- Start Positron ---
		// In Positron: Claude (recent) in promoted, then Other Models with remaining models
		assert.strictEqual(actions[0].label, 'Claude');
		assert.strictEqual(actions[1].label, 'Other Models');
		assert.strictEqual(actions[1].isSectionToggle, true);
		// Remaining models in Other Models section (sorted alphabetically)
		assert.strictEqual(actions[2].label, 'Auto');
		assert.strictEqual(actions[3].label, 'Gemini');
		assert.strictEqual(actions[4].label, 'GPT-4o');
		// --- End Positron ---
	});

	test('recently used model not in models list but in controlModels shows as unavailable (upgrade for free user)', () => {
		const auto = createAutoModel();
		const items = callBuild([auto], {
			recentModelIds: ['missing-model'],
			controlModels: {
				'missing-model': { label: 'Missing Model', exists: false },
			},
			entitlement: ChatEntitlement.Free,
		});
		const actions = getActionItems(items);
		const unavailable = actions.find(a => a.label === 'Missing Model');
		assert.ok(unavailable);
		assert.strictEqual(unavailable.disabled, true);
	});

	test('recently used model not in models list shows as unavailable (update for version mismatch)', () => {
		const auto = createAutoModel();
		const items = callBuild([auto], {
			recentModelIds: ['missing-model'],
			controlModels: {
				'missing-model': { label: 'Missing Model', minVSCodeVersion: '2.0.0', exists: false },
			},
			currentVSCodeVersion: '1.90.0',
		});
		const actions = getActionItems(items);
		const unavailable = actions.find(a => a.label === 'Missing Model');
		assert.ok(unavailable);
		assert.strictEqual(unavailable.disabled, true);
	});

	test('recently used model not in models list shows as unavailable (admin for pro user without version issue)', () => {
		const auto = createAutoModel();
		const items = callBuild([auto], {
			recentModelIds: ['missing-model'],
			controlModels: {
				'missing-model': { label: 'Missing Model', exists: false },
			},
		});
		const actions = getActionItems(items);
		const unavailable = actions.find(a => a.label === 'Missing Model');
		assert.ok(unavailable);
		assert.strictEqual(unavailable.disabled, true);
	});

	test('featured control models appear in promoted section', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const modelB = createModel('claude', 'Claude');
		const items = callBuild([auto, modelA, modelB], {
			controlModels: {
				'gpt-4o': { label: 'GPT-4o', featured: true, exists: true },
			},
		});
		const actions = getActionItems(items);
		// --- Start Positron ---
		// In Positron: GPT-4o (featured) in promoted, then Other Models with remaining models
		assert.strictEqual(actions[0].label, 'GPT-4o');
		assert.strictEqual(actions[1].label, 'Other Models');
		assert.strictEqual(actions[1].isSectionToggle, true);
		// Auto and Claude in Other Models section (sorted alphabetically)
		assert.strictEqual(actions[2].label, 'Auto');
		assert.strictEqual(actions[3].label, 'Claude');
		// --- End Positron ---
	});

	test('featured model not in models list shows as unavailable for free users (upgrade)', () => {
		const auto = createAutoModel();
		const items = callBuild([auto], {
			controlModels: {
				'premium-model': { label: 'Premium Model', featured: true, exists: false },
			},
			entitlement: ChatEntitlement.Free,
		});
		const actions = getActionItems(items);
		const unavailable = actions.find(a => a.label === 'Premium Model');
		assert.ok(unavailable);
		assert.strictEqual(unavailable.disabled, true);
	});

	test('featured model not in models list shows as unavailable for pro users (admin)', () => {
		const auto = createAutoModel();
		const items = callBuild([auto], {
			controlModels: {
				'premium-model': { label: 'Premium Model', featured: true, exists: false },
			},
		});
		const actions = getActionItems(items);
		const unavailable = actions.find(a => a.label === 'Premium Model');
		assert.ok(unavailable);
		assert.strictEqual(unavailable.disabled, true);
	});

	test('featured model with minVSCodeVersion shows as unavailable (update) when version too low', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const items = callBuild([auto, modelA], {
			controlModels: {
				'gpt-4o': { label: 'GPT-4o', featured: true, minVSCodeVersion: '2.0.0', exists: true },
			},
			currentVSCodeVersion: '1.90.0',
		});
		const actions = getActionItems(items);
		const unavailable = actions.find(a => a.label === 'GPT-4o');
		assert.ok(unavailable);
		assert.strictEqual(unavailable.disabled, true);
	});

	test('non-featured control models do NOT appear in promoted section', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const modelB = createModel('claude', 'Claude');
		const items = callBuild([auto, modelA, modelB], {
			controlModels: {
				'gpt-4o': { label: 'GPT-4o', featured: false, exists: true },
			},
		});
		// With no selected, no recent, and no featured, all models should be in Other
		const seps = items.filter(i => i.kind === ActionListItemKind.Separator);
		// --- Start Positron ---
		// Positron adds provider separators
		assert.ok(seps.length >= 2);
		const actions = getActionItems(items);
		// All models in Other Models section
		assert.strictEqual(actions[0].label, 'Other Models');
		assert.strictEqual(actions[0].isSectionToggle, true);
		// Models sorted alphabetically
		assert.strictEqual(actions[1].label, 'Auto');
		assert.strictEqual(actions[2].label, 'Claude');
		assert.strictEqual(actions[3].label, 'GPT-4o');
		// --- End Positron ---
	});

	test('available promoted models are sorted alphabetically', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const modelB = createModel('claude', 'Claude');
		const modelC = createModel('gemini', 'Gemini');
		const items = callBuild([auto, modelA, modelB, modelC], {
			recentModelIds: [modelA.identifier, modelB.identifier, modelC.identifier],
		});
		const actions = getActionItems(items);
		// --- Start Positron ---
		// In Positron: promoted models sorted alphabetically, then Other Models with Auto
		assert.strictEqual(actions[0].label, 'Claude');
		assert.strictEqual(actions[1].label, 'Gemini');
		assert.strictEqual(actions[2].label, 'GPT-4o');
		assert.strictEqual(actions[3].label, 'Other Models');
		assert.strictEqual(actions[3].isSectionToggle, true);
		assert.strictEqual(actions[4].label, 'Auto');
		// --- End Positron ---
	});

	test('unavailable promoted models appear after available ones', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const items = callBuild([auto, modelA], {
			recentModelIds: [modelA.identifier, 'missing-model'],
			controlModels: {
				'missing-model': { label: 'Missing Model', exists: false },
			},
			entitlement: ChatEntitlement.Free,
		});
		const actions = getActionItems(items);
		// --- Start Positron ---
		// In Positron: available promoted first, then unavailable, then Other Models
		assert.strictEqual(actions[0].label, 'GPT-4o');
		assert.ok(!actions[0].disabled);
		assert.strictEqual(actions[1].label, 'Missing Model');
		assert.strictEqual(actions[1].disabled, true);
		assert.strictEqual(actions[2].label, 'Other Models');
		assert.strictEqual(actions[2].isSectionToggle, true);
		assert.strictEqual(actions[3].label, 'Auto');
		// --- End Positron ---
	});

	test('models not in promoted section appear in Other Models section', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const modelB = createModel('claude', 'Claude');
		const items = callBuild([auto, modelA, modelB]);
		const actions = getActionItems(items);
		// --- Start Positron ---
		// In Positron: all models in Other Models section (no promoted items)
		assert.strictEqual(actions[0].label, 'Other Models');
		assert.strictEqual(actions[0].isSectionToggle, true);
		// Models sorted alphabetically
		assert.strictEqual(actions[1].label, 'Auto');
		assert.strictEqual(actions[2].label, 'Claude');
		assert.strictEqual(actions[3].label, 'GPT-4o');
		// --- End Positron ---
	});

	test('Other Models section includes section toggle', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const items = callBuild([auto, modelA]);
		const toggles = getActionItems(items).filter(i => i.isSectionToggle);
		assert.strictEqual(toggles.length, 1);
		assert.ok(toggles[0].label!.includes('Other Models'));
	});

	test('Other Models section includes Manage Models entry', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const items = callBuild([auto, modelA]);
		const manageItem = getActionItems(items).find(i => i.item?.id === 'manageModels');
		assert.ok(manageItem);
		assert.ok(manageItem.label!.includes('Manage Models'));
	});

	test('Other Models with minVSCodeVersion that fails shows as disabled', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const items = callBuild([auto, modelA], {
			controlModels: {
				'gpt-4o': { label: 'GPT-4o', minVSCodeVersion: '2.0.0', exists: true },
			},
			currentVSCodeVersion: '1.90.0',
		});
		const actions = getActionItems(items);
		const gptItem = actions.find(a => a.label === 'GPT-4o');
		assert.ok(gptItem);
		assert.strictEqual(gptItem.disabled, true);
	});

	test('Other Models places unavailable models after available models', () => {
		const auto = createAutoModel();
		const availableModel = createModel('zeta', 'Zeta');
		const unavailableModel = createModel('alpha', 'Alpha');
		const items = callBuild([auto, availableModel, unavailableModel], {
			controlModels: {
				'alpha': { label: 'Alpha', minVSCodeVersion: '2.0.0', exists: true },
			},
			currentVSCodeVersion: '1.90.0',
		});
		const actions = getActionItems(items);
		// --- Start Positron ---
		// In Positron: Other Models toggle, then available models, then unavailable models
		assert.strictEqual(actions[0].label, 'Other Models');
		assert.strictEqual(actions[0].isSectionToggle, true);
		// Available models first (Auto, Zeta), then unavailable (Alpha)
		assert.strictEqual(actions[1].label, 'Auto');
		assert.strictEqual(actions[2].label, 'Zeta');
		assert.strictEqual(actions[3].label, 'Alpha');
		assert.strictEqual(actions[3].disabled, true);
		// --- End Positron ---
	});

	test('no duplicate models across sections', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const modelB = createModel('claude', 'Claude');
		const modelC = createModel('gemini', 'Gemini');
		const items = callBuild([auto, modelA, modelB, modelC], {
			selectedModelId: modelA.identifier,
			recentModelIds: [modelA.identifier, modelB.identifier],
			controlModels: {
				'gpt-4o': { label: 'GPT-4o', featured: true, exists: true },
				'claude': { label: 'Claude', featured: true, exists: true },
			},
		});
		// --- Start Positron ---
		// Filter out footer items (Manage Models, Configure Model Providers)
		const labels = getActionLabels(items).filter(l => l !== 'Other Models' && !l.includes('Manage Models') && !l.includes('Configure'));
		// --- End Positron ---
		const uniqueLabels = new Set(labels);
		assert.strictEqual(labels.length, uniqueLabels.size, `Duplicate labels found: ${labels.join(', ')}`);
	});

	test('auto model is excluded from promoted and other sections', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const items = callBuild([auto, modelA], {
			selectedModelId: auto.identifier,
			recentModelIds: [auto.identifier],
			controlModels: {
				'auto': { label: 'Auto', featured: true, exists: true },
			},
		});
		const autoItems = getActionItems(items).filter(a => a.label === 'Auto');
		// Auto should appear exactly once
		assert.strictEqual(autoItems.length, 1);
	});

	test('models with no control manifest entries work fine', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const modelB = createModel('claude', 'Claude');
		const items = callBuild([auto, modelA, modelB], {
			controlModels: {},
		});
		const actions = getActionItems(items);
		// --- Start Positron ---
		// In Positron: all models in Other Models section
		assert.strictEqual(actions[0].label, 'Other Models');
		assert.strictEqual(actions[0].isSectionToggle, true);
		// Models sorted alphabetically
		assert.strictEqual(actions[1].label, 'Auto');
		assert.strictEqual(actions[2].label, 'Claude');
		assert.strictEqual(actions[3].label, 'GPT-4o');
		// --- End Positron ---
	});

	test('Other Models sorted by vendor then name', () => {
		const auto = createAutoModel();
		const modelA = createModel('zebra', 'Zebra', 'copilot');
		const modelB = createModel('alpha', 'Alpha', 'other-vendor');
		const modelC = createModel('beta', 'Beta', 'copilot');
		const items = callBuild([auto, modelA, modelB, modelC]);
		const actions = getActionItems(items);
		// --- Start Positron ---
		// In Positron: Other Models toggle, then models sorted by vendor then name
		assert.strictEqual(actions[0].label, 'Other Models');
		assert.strictEqual(actions[0].isSectionToggle, true);
		// copilot models first (Auto, Beta, Zebra sorted by name), then other-vendor (Alpha)
		assert.strictEqual(actions[1].label, 'Auto');
		assert.strictEqual(actions[2].label, 'Beta');
		assert.strictEqual(actions[3].label, 'Zebra');
		assert.strictEqual(actions[4].label, 'Alpha');
		// --- End Positron ---
	});

	test('onSelect callback is wired into action items', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		let selectedModel: ILanguageModelChatMetadataAndIdentifier | undefined;
		const onSelect = (m: ILanguageModelChatMetadataAndIdentifier) => { selectedModel = m; };
		const items = buildModelPickerItems(
			[auto, modelA],
			undefined,
			[],
			{},
			'1.100.0',
			StateType.Idle,
			onSelect,
			undefined,
			true,
			stubCommandService,
			stubChatEntitlementService,
		);
		const gptItem = getActionItems(items).find(a => a.label === 'GPT-4o');
		assert.ok(gptItem?.item);
		gptItem.item.run();
		assert.strictEqual(selectedModel?.identifier, modelA.identifier);
	});

	test('selected model is checked, others are not', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const modelB = createModel('claude', 'Claude');
		const items = callBuild([auto, modelA, modelB], {
			selectedModelId: modelA.identifier,
		});
		const actions = getActionItems(items);
		const autoItem = actions.find(a => a.label === 'Auto');
		const gptItem = actions.find(a => a.label === 'GPT-4o');
		const claudeItem = actions.find(a => a.label === 'Claude');
		assert.ok(!autoItem?.item?.checked);
		assert.ok(gptItem?.item?.checked);
		assert.ok(!claudeItem?.item?.checked);
	});

	test('selected auto model is checked', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const items = callBuild([auto, modelA], {
			selectedModelId: auto.identifier,
		});
		const actions = getActionItems(items);
		// --- Start Positron ---
		// In Positron: Auto is not promoted even when selected - it stays in Other Models but is checked
		assert.strictEqual(actions[0].label, 'Other Models');
		assert.strictEqual(actions[0].isSectionToggle, true);
		assert.strictEqual(actions[1].label, 'Auto');
		assert.ok(actions[1].item?.checked);
		assert.strictEqual(actions[2].label, 'GPT-4o');
		// --- End Positron ---
	});

	test('recently used model resolved by metadata id', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		const modelB = createModel('claude', 'Claude');
		// Use metadata id rather than identifier
		const items = callBuild([auto, modelA, modelB], {
			recentModelIds: ['claude'],
		});
		const actions = getActionItems(items);
		// --- Start Positron ---
		// In Positron: Claude (recent) in promoted, then Other Models with remaining
		assert.strictEqual(actions[0].label, 'Claude');
		assert.strictEqual(actions[1].label, 'Other Models');
		assert.strictEqual(actions[1].isSectionToggle, true);
		// Auto and GPT-4o in Other Models (sorted alphabetically)
		assert.strictEqual(actions[2].label, 'Auto');
		assert.strictEqual(actions[3].label, 'GPT-4o');
		// --- End Positron ---
	});

	test('multiple featured and recent models all promoted correctly', () => {
		const auto = createAutoModel();
		const modelA = createModel('alpha', 'Alpha');
		const modelB = createModel('beta', 'Beta');
		const modelC = createModel('gamma', 'Gamma');
		const modelD = createModel('delta', 'Delta');
		const items = callBuild([auto, modelA, modelB, modelC, modelD], {
			recentModelIds: [modelC.identifier],
			controlModels: {
				'alpha': { label: 'Alpha', featured: true, exists: true },
			},
		});
		const actions = getActionItems(items);
		// --- Start Positron ---
		// In Positron: promoted models (Alpha featured, Gamma recent) sorted alphabetically, then Other Models
		assert.strictEqual(actions[0].label, 'Alpha');
		assert.strictEqual(actions[1].label, 'Gamma');
		assert.strictEqual(actions[2].label, 'Other Models');
		assert.strictEqual(actions[2].isSectionToggle, true);
		// Remaining models in Other Models (Auto, Beta, Delta sorted alphabetically)
		assert.strictEqual(actions[3].label, 'Auto');
		assert.strictEqual(actions[4].label, 'Beta');
		assert.strictEqual(actions[5].label, 'Delta');
		// --- End Positron ---
	});

	test('admin unavailable model shows manage settings link in description', () => {
		const auto = createAutoModel();
		const items = buildModelPickerItems(
			[auto],
			undefined,
			['missing-model'],
			{ 'missing-model': { label: 'Missing Model' } as IModelControlEntry },
			'1.100.0',
			StateType.Idle,
			() => { },
			'https://aka.ms/github-copilot-settings',
			true,
			stubCommandService,
			stubChatEntitlementService,
		);

		const adminItem = getActionItems(items).find(a => a.label === 'Missing Model');
		assert.ok(adminItem);
		assert.strictEqual(adminItem.disabled, true);
		const description = adminItem.description;
		assert.ok(description instanceof MarkdownString);
		assert.ok(description.value.includes('https://aka.ms/github-copilot-settings'));
	});

	test('unavailable models keep indentation with blank icon', () => {
		const auto = createAutoModel();
		const items = callBuild([auto], {
			recentModelIds: ['missing-model'],
			controlModels: {
				'missing-model': { label: 'Missing Model' } as IModelControlEntry,
			},
			entitlement: ChatEntitlement.Free,
		});

		const unavailable = getActionItems(items).find(a => a.label === 'Missing Model');
		assert.ok(unavailable);
		assert.strictEqual(unavailable.hideIcon, false);
		assert.strictEqual(unavailable.group?.icon?.id, Codicon.blank.id);
	});

	test('anonymous user sees upgrade description on each unavailable model', () => {
		const auto = createAutoModel();
		const items = callBuild([auto], {
			recentModelIds: ['model-a', 'model-b'],
			controlModels: {
				'model-a': { label: 'Model A', featured: true, exists: false },
				'model-b': { label: 'Model B', featured: true, exists: false },
			},
			anonymous: true,
			entitlement: ChatEntitlement.Unknown,
		});
		const actions = getActionItems(items);
		const disabledItems = actions.filter(a => a.disabled);
		assert.strictEqual(disabledItems.length, 2);
		assert.ok(disabledItems[0].description instanceof MarkdownString);
		assert.ok(disabledItems[0].description.value.includes('Upgrade'));
		assert.ok(disabledItems[1].description instanceof MarkdownString);
		assert.ok(disabledItems[1].description.value.includes('Upgrade'));
	});

	test('free user sees upgrade description on each unavailable model', () => {
		const auto = createAutoModel();
		const items = callBuild([auto], {
			recentModelIds: ['model-a', 'model-b'],
			controlModels: {
				'model-a': { label: 'Model A', featured: true, exists: false },
				'model-b': { label: 'Model B', featured: true, exists: false },
			},
			entitlement: ChatEntitlement.Free,
		});
		const actions = getActionItems(items);
		const disabledItems = actions.filter(a => a.disabled);
		assert.strictEqual(disabledItems.length, 2);
		assert.ok(disabledItems[0].description instanceof MarkdownString);
		assert.ok(disabledItems[0].description.value.includes('Upgrade'));
		assert.ok(disabledItems[1].description instanceof MarkdownString);
		assert.ok(disabledItems[1].description.value.includes('Upgrade'));
	});

	test('anonymous user model selection triggers onSelect normally', () => {
		const auto = createAutoModel();
		const modelA = createModel('gpt-4o', 'GPT-4o');
		let selectedModel: ILanguageModelChatMetadataAndIdentifier | undefined;
		const onSelect = (m: ILanguageModelChatMetadataAndIdentifier) => { selectedModel = m; };
		const anonymousEntitlementService = createStubEntitlementService({ entitlement: ChatEntitlement.Unknown, anonymous: true });
		const items = buildModelPickerItems(
			[auto, modelA],
			undefined,
			[],
			{},
			'1.100.0',
			StateType.Idle,
			onSelect,
			undefined,
			true,
			stubCommandService,
			anonymousEntitlementService,
		);
		const gptItem = getActionItems(items).find(a => a.label === 'GPT-4o');
		assert.ok(gptItem?.item);
		gptItem.item.run();
		assert.strictEqual(selectedModel?.identifier, modelA.identifier);
	});
});
