/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { Position } from '../../../../common/core/position.js';
import { ITextModel } from '../../../../common/model.js';

/**
 * A provider that can handle a modifier+click (Cmd/Ctrl+Click) on an identifier
 * in the editor before go-to-definition runs.
 *
 * This is the editor-layer seam that lets the workbench redirect a click on,
 * say, a data frame to the Data Explorer instead of navigating to its
 * definition. It lives here (rather than as an injected service) because there
 * is no `@optional` DI decorator in this codebase and go-to-definition must keep
 * working in the standalone editor, where nothing registers a provider.
 */
export interface IClickToViewProvider {
	/**
	 * Attempt to handle a modifier+click at the given position.
	 *
	 * @returns `true` if the click was handled and go-to-definition should be
	 * skipped; `false` to fall through to the normal go-to-definition behavior.
	 * Implementations must not throw: a rejected promise is treated as unhandled.
	 */
	handleClick(model: ITextModel, position: Position): Promise<boolean>;
}

/**
 * The single registered click-to-view provider, or `undefined` when none is
 * registered (e.g. the standalone editor). A single slot is sufficient: only
 * one workbench contribution registers a provider.
 */
let provider: IClickToViewProvider | undefined;

/**
 * Registers the click-to-view provider consulted by go-to-definition on
 * modifier+click. Registering replaces any previous provider; disposing the
 * returned {@link IDisposable} clears it (only if it is still the current one).
 */
export function registerClickToViewProvider(newProvider: IClickToViewProvider): IDisposable {
	provider = newProvider;
	return toDisposable(() => {
		if (provider === newProvider) {
			provider = undefined;
		}
	});
}

/**
 * Returns the registered click-to-view provider, or `undefined` if none.
 */
export function getClickToViewProvider(): IClickToViewProvider | undefined {
	return provider;
}
