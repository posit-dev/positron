/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';

/**
 * Context key holding the set of language IDs for which a Positron language
 * runtime has been registered. Use with the `in` operator in a `when` clause
 * to scope menus/actions to editors whose language has a runtime, e.g.
 * `resourceLangId in positron.runtimeLanguageIds`.
 *
 * Populated dynamically from `ILanguageRuntimeService.registeredRuntimes` so
 * it stays accurate as runtimes are discovered at workspace startup without
 * a hardcoded language list.
 *
 * Note: `ILanguageRuntimeService` exposes `onDidRegisterRuntime` but does not
 * emit an unregister event. The list will grow monotonically within a session,
 * which is acceptable here: the worst case is that a menu entry remains
 * visible for a language whose runtime was unregistered, and the action
 * itself already handles the "no active session" case with a notification.
 */
export const POSITRON_RUNTIME_LANGUAGE_IDS = new RawContextKey<string[]>(
	'positron.runtimeLanguageIds',
	[],
	{
		type: 'array',
		description: localize(
			'positron.runtimeLanguageIds.description',
			"Language IDs for which a Positron language runtime is registered.",
		),
	},
);

/**
 * Workbench contribution that keeps {@link POSITRON_RUNTIME_LANGUAGE_IDS} in
 * sync with the set of registered language runtimes.
 */
export class PositronRuntimeLanguagesContextKeyContribution
	extends Disposable
	implements IWorkbenchContribution {

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ILanguageRuntimeService languageRuntimeService: ILanguageRuntimeService,
	) {
		super();

		const contextKey = POSITRON_RUNTIME_LANGUAGE_IDS.bindTo(contextKeyService);
		const update = () => {
			const languageIds = Array.from(new Set(
				languageRuntimeService.registeredRuntimes.map(r => r.languageId),
			));
			contextKey.set(languageIds);
		};

		update();
		this._register(languageRuntimeService.onDidRegisterRuntime(update));
	}
}
