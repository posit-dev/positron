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
