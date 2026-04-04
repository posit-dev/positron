/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal stub for the 'positron' module used by vitest tests that transitively
 * depend on extension code importing positron. Only implements the subset of
 * enums and APIs that are referenced at module initialization time.
 */

export enum PositronLanguageModelType {
	Chat = 'chat',
	Completion = 'completion',
}

export const version = '0.0.0';
export const buildNumber = 0;

export const ai = {
	LanguageModelAutoconfigureType: {
		EnvVariable: 0,
		Custom: 1,
	} as const,
	getEnabledProviders: () => Promise.resolve([]),
	addLanguageModelConfig: () => { },
};

export const notebooks = {
	NotebookCellType: {
		Code: 'code',
		Markup: 'markup',
		Markdown: 'markdown',
	} as const,
};
