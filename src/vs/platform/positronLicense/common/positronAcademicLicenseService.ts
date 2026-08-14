/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IPositronAcademicLicenseService = createDecorator<IPositronAcademicLicenseService>('positronAcademicLicenseService');

/**
 * Reports whether this Positron session is running under a license that grants the
 * Education License Rider terms. Drives the academic license banner and the
 * `positron-is-academic` P3M telemetry param.
 *
 * Node/server: derived from the validated license (see `remoteLicenseKey.ts`'s
 * `ILicenseValidationResult.academic`) at server startup. Browser: derived from the
 * `_POSITRON_IS_ACADEMIC` global injected by `webClientServer.ts`. Desktop: always false,
 * since desktop installs never go through a license check.
 */
export interface IPositronAcademicLicenseService {
	readonly _serviceBrand: undefined;

	/** Whether this session is running under an academic license. */
	readonly isAcademic: boolean;
}

/**
 * Builds the inline `<script>` that tells the browser this session is academic, for injection
 * into the served workbench HTML by `webClientServer.ts`. Empty when the session is not
 * academic: the absence of the global means false, which is the common case.
 *
 * The global name here must stay in sync with the one `isAcademic` reads in
 * `base/common/platform.ts`. It cannot be shared as a constant -- `base` may not import from
 * `platform` -- so the string is duplicated there and pinned by this function's test.
 */
export function academicMarkerScript(isAcademic: boolean): string {
	return isAcademic ? '<script>globalThis._POSITRON_IS_ACADEMIC = true;</script>' : '';
}
