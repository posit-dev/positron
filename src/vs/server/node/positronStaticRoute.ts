/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Daily builds differ from Workbench's nginx-served install, so they use session-scoped URLs.
export function shouldUseSessionLessStaticRoute(isWorkbench: boolean, hasStaticRoute: boolean, quality: string | undefined): boolean {
	return isWorkbench && hasStaticRoute && quality !== 'dailies';
}
