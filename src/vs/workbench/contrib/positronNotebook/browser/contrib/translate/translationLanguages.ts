/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ITranslationProvider {
	translate(text: string, sourceLanguage: string, targetLanguage: string): Promise<string>;
}

export interface TranslationLanguage {
	readonly id: string;
	readonly label: string;
	readonly code: string;
}

export const SUPPORTED_LANGUAGES: TranslationLanguage[] = [
	{ id: 'en', label: 'English', code: 'en' },
	{ id: 'pt', label: 'Portuguese', code: 'pt' },
	{ id: 'es', label: 'Spanish', code: 'es' },
	{ id: 'fr', label: 'French', code: 'fr' },
	{ id: 'de', label: 'German', code: 'de' },
	{ id: 'ar', label: 'Arabic', code: 'ar' },
];

const LANGUAGE_LABELS = new Map(SUPPORTED_LANGUAGES.map(l => [l.code, l.label]));
const LANGUAGE_CODES = new Set(SUPPORTED_LANGUAGES.map(l => l.code));

export function isKnownLanguageCode(code: string): boolean {
	return LANGUAGE_CODES.has(code);
}

export function getLanguageLabel(code: string): string {
	return LANGUAGE_LABELS.get(code) ?? code;
}
