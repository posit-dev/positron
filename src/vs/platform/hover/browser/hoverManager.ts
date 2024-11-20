/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * IHoverManager interface.
 */
export interface IHoverManager {
	/**
	 * Shows a hover.
	 * @param target The target.
	 * @param content The content.
	 */
	showHover(target: HTMLElement, content?: string | (() => string | undefined)): void;

	/**
	 * Hides the hover if it was visible.
	 */
	hideHover(): void;
}
