/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IPositronAcademicLicenseService = createDecorator<IPositronAcademicLicenseService>('positronAcademicLicenseService');

/**
 * Reports whether this Positron session is running under a license that grants the
 * Education License Rider terms.
 *
 * Node/server: derived from the validated license (see `remoteLicenseKey.ts`'s
 * `ILicenseValidationResult.academic`) at server startup. Browser: derived from the
 * global injected by `webClientServer.ts` (see {@link academicMarkerScript}). Desktop:
 * always false, since desktop installs never go through a license check.
 */
export interface IPositronAcademicLicenseService {
	readonly _serviceBrand: undefined;

	/** Whether this session is running under an academic license. */
	readonly isAcademic: boolean;
}

/** Name of the injected global that marks a browser session academic; see {@link academicMarkerScript}. */
export const POSITRON_IS_ACADEMIC_GLOBAL = '_POSITRON_IS_ACADEMIC';

/**
 * Builds the inline `<script>` that tells the browser this session is academic, for injection
 * into the served workbench HTML by `webClientServer.ts`. Empty when the session is not
 * academic: the absence of the global means false, which is the common case.
 */
export function academicMarkerScript(isAcademic: boolean): string {
	return isAcademic ? `<script>globalThis.${POSITRON_IS_ACADEMIC_GLOBAL} = true;</script>` : '';
}
