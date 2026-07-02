/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IConsoleErrorFollowupService = createDecorator<IConsoleErrorFollowupService>('consoleErrorFollowupService');

/**
 * A runtime error surfaced in the console, in a shape providers can match
 * against to offer a follow-up action.
 */
export interface IConsoleError {
	/** The session that produced the error. */
	readonly sessionId: string;
	/** The language of the session (e.g. "python", "r"). */
	readonly languageId: string;
	/** The error name, e.g. "ModuleNotFoundError". May be empty. */
	readonly name: string;
	/** The error message, e.g. "No module named 'garfblatz'". */
	readonly message: string;
	/** The error traceback, one entry per line. */
	readonly traceback: string[];
}

/**
 * A follow-up action offered beneath a console error, rendered as an icon + link.
 */
export interface IConsoleErrorSuggestion {
	/** Theme-colored icon id; the missing-package suggestion uses a lightbulb. */
	readonly icon: ThemeIcon;
	/** Link text, e.g. "Install garfblatz". */
	readonly label: string;
	/** Invoked when the link is clicked. */
	run(): Promise<void>;
}

/**
 * Provides follow-up suggestions for a console error. Implementations should
 * return an empty array when they do not recognize the error, and must not
 * offer an action they cannot actually perform.
 */
export interface IConsoleErrorSuggestionProvider {
	provideSuggestions(error: IConsoleError, token: CancellationToken): Promise<IConsoleErrorSuggestion[]>;
}

/**
 * A registry that turns a console error into follow-up suggestions by fanning
 * the error out to all registered providers. Generic by design so features
 * beyond missing-package installation (deprecation hints, typo fixes, ...) can
 * plug in later.
 */
export interface IConsoleErrorFollowupService {
	readonly _serviceBrand: undefined;

	/** Registers a suggestion provider. Dispose the result to unregister. */
	registerProvider(provider: IConsoleErrorSuggestionProvider): IDisposable;

	/** Collects suggestions for an error from every registered provider. */
	getSuggestions(error: IConsoleError, token: CancellationToken): Promise<IConsoleErrorSuggestion[]>;
}

/**
 * Default implementation of {@link IConsoleErrorFollowupService}.
 */
export class ConsoleErrorFollowupService implements IConsoleErrorFollowupService {
	declare readonly _serviceBrand: undefined;

	private readonly _providers = new Set<IConsoleErrorSuggestionProvider>();

	registerProvider(provider: IConsoleErrorSuggestionProvider): IDisposable {
		this._providers.add(provider);
		return toDisposable(() => this._providers.delete(provider));
	}

	async getSuggestions(error: IConsoleError, token: CancellationToken): Promise<IConsoleErrorSuggestion[]> {
		const results = await Promise.all(
			[...this._providers].map(async provider => {
				try {
					return await provider.provideSuggestions(error, token);
				} catch {
					// A failing provider must not break the others or the console.
					return [];
				}
			})
		);
		return results.flat();
	}
}

registerSingleton(IConsoleErrorFollowupService, ConsoleErrorFollowupService, InstantiationType.Delayed);
