/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Model configuration: maps short names to display names and UI picker names.
 */
export const MODEL_CONFIG: Record<string, { displayName: string; pickerName: string }> = {
	'sonnet': { displayName: 'claude sonnet 4', pickerName: 'Claude Sonnet 4' },
	'opus': { displayName: 'claude opus 4', pickerName: 'Claude Opus 4' },
};

const DEFAULT_MODELS = ['sonnet'];

/**
 * Get the model keys from environment variable.
 * - EVAL_MODELS=opus → ['opus']
 * - EVAL_MODELS=sonnet,opus → ['sonnet', 'opus']
 * - (no env var) → ['sonnet']
 */
export function getModelKeys(): string[] {
	const envModels = process.env.EVAL_MODELS?.toLowerCase();
	if (!envModels) {
		return DEFAULT_MODELS;
	}

	const models = envModels.split(',').map(m => m.trim()).filter(m => m);
	const validModels = models.filter(m => {
		if (!MODEL_CONFIG[m]) {
			console.warn(`Unknown model "${m}", skipping`);
			return false;
		}
		return true;
	});

	return validModels.length > 0 ? validModels : DEFAULT_MODELS;
}

/**
 * Get config for a specific model key.
 */
export function getModelConfig(modelKey: string): { displayName: string; pickerName: string } {
	return MODEL_CONFIG[modelKey] || MODEL_CONFIG['sonnet'];
}
