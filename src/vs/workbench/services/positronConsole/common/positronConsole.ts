/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { HistoryNavigator2 } from 'vs/base/common/history';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// Create the decorator for the Positron console service (used in dependency injection).
export const IPositronConsoleService = createDecorator<IPositronConsoleService>('positronConsoleService');

export interface IPositronConsoleOptions {
	language?: string;
}

/**
 * IPositronConsoleInstance interface.
 */
export interface IPositronConsoleInstance {
	readonly languageId: string;

	readonly runtime: ILanguageRuntime;

	readonly displayName: string;

	readonly history: HistoryNavigator2<string>;

	readonly onDidClearConsole: Event<void>;

	readonly onDidExecuteCode: Event<string>;

	clear(): void;

	executeCode(code: string): void;
}

/**
 * IPositronConsoleService interface.
 */
export interface IPositronConsoleService {
	// Needed for service branding in dependency injector.
	readonly _serviceBrand: undefined;

	readonly instances: readonly IPositronConsoleInstance[];

	readonly activeInstance: IPositronConsoleInstance | undefined;

	readonly onDidStartConsole: Event<IPositronConsoleInstance>;

	readonly onDidChangeActiveConsole: Event<IPositronConsoleInstance | undefined>;

	createConsole(options?: IPositronConsoleOptions): Promise<IPositronConsoleInstance>;

	clearActiveConsole(): void;

	executeCode(languageId: string, code: string): void;
}
