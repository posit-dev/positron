/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContextKeyExpr, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

// View ID
export const POSITRON_PACKAGES_VIEW_ID = 'workbench.view.positronPackages.view';

// Context keys for the packages view
export const POSITRON_PACKAGES_HAS_ACTIVE_SESSION = new RawContextKey<boolean>('positronPackages.hasActiveSession', false);
export const POSITRON_PACKAGES_IS_BUSY = new RawContextKey<boolean>('positronPackages.isBusy', false);
export const POSITRON_PACKAGES_SELECTED_PACKAGE = new RawContextKey<string>('positronPackages.selectedPackage', '');

// Context key expressions for menu enablement
export const PACKAGES_VIEW_VISIBLE = ContextKeyExpr.equals('view', POSITRON_PACKAGES_VIEW_ID);
export const PACKAGES_CAN_RUN_ACTION = ContextKeyExpr.and(
	POSITRON_PACKAGES_HAS_ACTIVE_SESSION,
	POSITRON_PACKAGES_IS_BUSY.negate()
);
export const PACKAGES_HAS_SELECTION = ContextKeyExpr.and(
	PACKAGES_CAN_RUN_ACTION,
	POSITRON_PACKAGES_SELECTED_PACKAGE.notEqualsTo('')
);
