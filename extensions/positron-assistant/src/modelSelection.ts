/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { ParticipantService } from './participants.js';

export type ModelSelectionSource = 'configured' | 'session' | 'provider' | 'fallback';
export type ConfiguredModelMatchMode = 'partial' | 'boundary';

export interface ModelSelectionResult {
	model: vscode.LanguageModelChat;
	source: ModelSelectionSource;
	/** True when configured model patterns existed but selection fell back to another source. */
	usedFallback: boolean;
}

interface ConfiguredModelOptions {
	patterns: string[];
	matchMode: ConfiguredModelMatchMode;
}

export interface SelectPreferredModelOptions {
	participantService: ParticipantService;
	log: vscode.LogOutputChannel;
	logPrefix: string;
	token?: vscode.CancellationToken;
	configuredModels?: ConfiguredModelOptions;
}

export interface GetCandidateModelsOptions {
	participantService: ParticipantService;
	token?: vscode.CancellationToken;
	fallbackModelFilter?: (model: vscode.LanguageModelChat) => boolean;
}

function isCancelled(token?: vscode.CancellationToken): boolean {
	return token?.isCancellationRequested ?? false;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasConfiguredPatterns(patterns: string[] | undefined): patterns is string[] {
	return !!patterns?.some(pattern => pattern.trim().length > 0);
}

function findConfiguredModel(
	models: vscode.LanguageModelChat[],
	patterns: string[],
	matchMode: ConfiguredModelMatchMode,
	log: vscode.LogOutputChannel,
	logPrefix: string,
): vscode.LanguageModelChat | undefined {
	log.debug(`[${logPrefix}] Checking configured model patterns: ${JSON.stringify(patterns)}`);
	for (const pattern of patterns) {
		if (!pattern || pattern.trim() === '') {
			continue;
		}

		const exactMatch = models.find(m => m.id === pattern);
		if (exactMatch) {
			log.debug(`[${logPrefix}] Using configured model (exact match): ${exactMatch.name}`);
			return exactMatch;
		}

		const patternLower = pattern.toLowerCase();
		if (matchMode === 'partial') {
			const partialMatch = models.find(m =>
				m.id.toLowerCase().includes(patternLower) || m.name.toLowerCase().includes(patternLower)
			);
			if (partialMatch) {
				log.debug(`[${logPrefix}] Using configured model (partial match): ${partialMatch.name}`);
				return partialMatch;
			}
			log.debug(`[${logPrefix}] Pattern "${pattern}" did not match any model, trying next pattern`);
			continue;
		}

		const boundaryPattern = new RegExp(`(^|[\\s\\-_./])${escapeRegExp(patternLower)}($|[\\s\\-_./])`, 'i');
		const boundaryMatch = models.find(m =>
			boundaryPattern.test(m.id) || boundaryPattern.test(m.name)
		);
		if (boundaryMatch) {
			log.debug(`[${logPrefix}] Using configured model (boundary match): ${boundaryMatch.name}`);
			return boundaryMatch;
		}
	}

	log.warn(`[${logPrefix}] Configured model patterns not found: ${JSON.stringify(patterns)}`);
	return undefined;
}

export async function selectPreferredModel(options: SelectPreferredModelOptions): Promise<ModelSelectionResult | null> {
	const { participantService, log, logPrefix, token, configuredModels } = options;
	const configuredPatterns = configuredModels?.patterns;
	const hasConfiguredModel = hasConfiguredPatterns(configuredPatterns);

	if (hasConfiguredModel) {
		const allModels = await vscode.lm.selectChatModels();
		if (isCancelled(token)) { return null; }
		log.debug(`[${logPrefix}] Available models: ${allModels.length} total`);
		const configured = findConfiguredModel(
			allModels,
			configuredPatterns,
			configuredModels.matchMode,
			log,
			logPrefix,
		);
		if (configured) {
			return { model: configured, source: 'configured', usedFallback: false };
		}
	}

	if (isCancelled(token)) { return null; }
	const sessionModelId = participantService.getCurrentSessionModel();
	if (sessionModelId) {
		log.debug(`[${logPrefix}] Checking session model: ${sessionModelId}`);
		const models = await vscode.lm.selectChatModels({ id: sessionModelId });
		if (isCancelled(token)) { return null; }
		if (models && models.length > 0) {
			log.debug(`[${logPrefix}] Using session model: ${models[0].name}`);
			return { model: models[0], source: 'session', usedFallback: hasConfiguredModel };
		}
	}

	if (isCancelled(token)) { return null; }
	const currentProvider = await positron.ai.getCurrentProvider();
	if (isCancelled(token)) { return null; }
	if (currentProvider) {
		log.debug(`[${logPrefix}] Checking current provider: ${currentProvider.id}`);
		const models = await vscode.lm.selectChatModels({ vendor: currentProvider.id });
		if (isCancelled(token)) { return null; }
		if (models && models.length > 0) {
			log.debug(`[${logPrefix}] Using provider model: ${models[0].name}`);
			return { model: models[0], source: 'provider', usedFallback: hasConfiguredModel };
		}
	}

	if (isCancelled(token)) { return null; }
	const [firstModel] = await vscode.lm.selectChatModels();
	if (isCancelled(token)) { return null; }
	if (firstModel) {
		log.debug(`[${logPrefix}] Using fallback model: ${firstModel.name}`);
		return { model: firstModel, source: 'fallback', usedFallback: hasConfiguredModel };
	}

	return null;
}

export async function getCandidateModels(options: GetCandidateModelsOptions): Promise<vscode.LanguageModelChat[] | null> {
	const { participantService, token, fallbackModelFilter } = options;
	const candidates: vscode.LanguageModelChat[] = [];
	const seen = new Set<string>();
	const addCandidate = (model: vscode.LanguageModelChat) => {
		if (!seen.has(model.id)) {
			seen.add(model.id);
			candidates.push(model);
		}
	};

	const sessionModelId = participantService.getCurrentSessionModel();
	if (sessionModelId) {
		const models = await vscode.lm.selectChatModels({ id: sessionModelId });
		if (isCancelled(token)) { return null; }
		if (models && models.length > 0) {
			addCandidate(models[0]);
		}
	}

	const currentProvider = await positron.ai.getCurrentProvider();
	if (isCancelled(token)) { return null; }
	if (currentProvider) {
		const models = await vscode.lm.selectChatModels({ vendor: currentProvider.id });
		if (isCancelled(token)) { return null; }
		for (const model of models) {
			addCandidate(model);
		}
	}

	const models = await vscode.lm.selectChatModels();
	if (isCancelled(token)) { return null; }
	for (const model of models) {
		if (!fallbackModelFilter || fallbackModelFilter(model)) {
			addCandidate(model);
		}
	}

	return candidates;
}
