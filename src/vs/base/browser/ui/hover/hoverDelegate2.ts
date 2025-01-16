/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../common/lifecycle.js';
import type { IHoverDelegate2 } from './hover.js';

let baseHoverDelegate: IHoverDelegate2 = {
	showHover: () => undefined,
	showDelayedHover: () => undefined,
	setupDelayedHover: () => Disposable.None,
	setupDelayedHoverAtMouse: () => Disposable.None,
	hideHover: () => undefined,
	showAndFocusLastHover: () => undefined,
	setupManagedHover: () => null!,
	showManagedHover: () => undefined
};

/**
 * Sets the hover delegate for use **only in the `base/` layer**.
 */
export function setBaseLayerHoverDelegate(hoverDelegate: IHoverDelegate2): void {
	baseHoverDelegate = hoverDelegate;
}

/**
 * Gets the hover delegate for use **only in the `base/` layer**.
 *
 * Since the hover service depends on various platform services, this delegate essentially bypasses
 * the standard dependency injection mechanism by injecting a global hover service at start up. The
 * only reason this should be used is if `IHoverService` is not available.
 */
export function getBaseLayerHoverDelegate(): IHoverDelegate2 {
	return baseHoverDelegate;
}
