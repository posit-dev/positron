/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { ExtensionIdentifier } from '../../../../../../platform/extensions/common/extensions.js';
import { ChatMessageRole, ILanguageModelsService } from '../../../../chat/common/languageModels.js';
import { ITranslationProvider, getLanguageLabel } from './translationLanguages.js';

export class AssistantTranslationProvider implements ITranslationProvider {

	constructor(
		private readonly _languageModelsService: ILanguageModelsService,
		private readonly _token: CancellationToken = CancellationToken.None,
	) { }

	async translate(text: string, sourceLanguage: string, targetLanguage: string): Promise<string> {
		if (!text.trim()) {
			return text;
		}

		const modelId = await this._resolveModelId();

		const sourceLabel = getLanguageLabel(sourceLanguage);
		const targetLabel = getLanguageLabel(targetLanguage);

		const prompt = [
			`Translate the following text from ${sourceLabel} to ${targetLabel}.`,
			'Return ONLY the translated text, with no explanation, no commentary, and no surrounding quotes.',
			'Preserve all formatting, whitespace, and line breaks exactly as they appear.',
			'',
			text,
		].join('\n');

		const response = await this._languageModelsService.sendChatRequest(
			modelId,
			new ExtensionIdentifier('positron-notebooks'),
			[{ role: ChatMessageRole.User, content: [{ type: 'text', value: prompt }] }],
			{},
			this._token,
		);

		let result = '';
		for await (const part of response.stream) {
			if (Array.isArray(part)) {
				for (const p of part) {
					if (p.type === 'text') {
						result += p.value;
					}
				}
			} else if (part.type === 'text') {
				result += part.value;
			}
		}

		await response.result;
		return result.trim();
	}

	private async _resolveModelId(): Promise<string> {
		const provider = this._languageModelsService.currentProvider;
		if (provider) {
			const models = await this._languageModelsService.selectLanguageModels({
				vendor: provider.id,
			});
			if (models.length > 0) {
				return models[0];
			}
		}

		const allModels = this._languageModelsService.getLanguageModelIds();
		if (allModels.length > 0) {
			return allModels[0];
		}

		throw new Error(
			'No language model is available. Please configure a provider in the Positron Assistant settings.'
		);
	}
}
