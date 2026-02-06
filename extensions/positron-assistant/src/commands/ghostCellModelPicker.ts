/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

interface ModelQuickPickItem extends vscode.QuickPickItem {
	modelId?: string;
	isDefault?: boolean;
}

/**
 * Opens a quick pick to select a model for ghost cell suggestions.
 * Groups models by vendor and allows selecting "Use Default" to restore auto-select behavior.
 */
export async function selectGhostCellModel(): Promise<void> {
	// Get all available models
	const allModels = await vscode.lm.selectChatModels();

	if (allModels.length === 0) {
		vscode.window.showWarningMessage(
			vscode.l10n.t('No language models available. Configure a model provider first.')
		);
		return;
	}

	// Get current setting to mark current selection
	const config = vscode.workspace.getConfiguration('positron.assistant.notebook');
	const currentPatterns = config.get<string[]>('ghostCellSuggestions.model') || [];
	const currentModelId = currentPatterns.length > 0 ? currentPatterns[0] : null;
	const isUsingDefault = !currentModelId ||
		(currentPatterns.length === 2 &&
			currentPatterns[0] === 'haiku' &&
			currentPatterns[1] === 'mini');

	// Group models by vendor
	const modelsByVendor = new Map<string, vscode.LanguageModelChat[]>();
	for (const model of allModels) {
		const vendor = model.vendor;
		if (!modelsByVendor.has(vendor)) {
			modelsByVendor.set(vendor, []);
		}
		modelsByVendor.get(vendor)!.push(model);
	}

	// Build quick pick items
	const items: ModelQuickPickItem[] = [];

	// Add "Use Default" option at top
	items.push({
		label: isUsingDefault
			? '$(check) Use Default (Auto-select)'
			: 'Use Default (Auto-select)',
		description: isUsingDefault ? '(current)' : undefined,
		detail: 'Automatically selects a fast model (Haiku, Mini, etc.)',
		isDefault: true
	});

	items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });

	// Add models grouped by vendor
	const sortedVendors = Array.from(modelsByVendor.keys()).sort();
	for (const vendor of sortedVendors) {
		const models = modelsByVendor.get(vendor)!;

		// Add vendor separator
		items.push({
			label: vendor,
			kind: vscode.QuickPickItemKind.Separator
		});

		// Add models for this vendor
		for (const model of models) {
			const isCurrent = !isUsingDefault && currentModelId === model.id;
			items.push({
				label: isCurrent ? `$(check) ${model.name}` : model.name,
				description: isCurrent ? '(current)' : undefined,
				detail: model.id,
				modelId: model.id
			});
		}
	}

	// Show quick pick
	const selected = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t('Select Model for Ghost Cell Suggestions'),
		placeHolder: vscode.l10n.t('Choose a model or use default auto-selection'),
		matchOnDetail: true
	});

	if (!selected) {
		return; // User cancelled
	}

	// Update the setting
	let newValue: string[];
	let message: string;

	if (selected.isDefault) {
		newValue = ['haiku', 'mini'];
		message = vscode.l10n.t('Ghost cell suggestions will use default model selection.');
	} else if (selected.modelId) {
		newValue = [selected.modelId];
		message = vscode.l10n.t('Ghost cell suggestions will use {0}.', selected.label.replace('$(check) ', ''));
	} else {
		return; // Separator or invalid item
	}

	await config.update(
		'ghostCellSuggestions.model',
		newValue,
		vscode.ConfigurationTarget.Global
	);

	vscode.window.showInformationMessage(message);
}
