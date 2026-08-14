/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronAcademicLicenseService } from '../common/positronAcademicLicenseService.js';

/**
 * Server-side implementation. Constructed once at startup with the academic status
 * already derived from the validated license (see `createServer()` in
 * `remoteExtensionHostAgentServer.ts`), since that derivation depends on an async
 * license check that happens before this service is registered.
 */
export class PositronAcademicLicenseService implements IPositronAcademicLicenseService {
	declare readonly _serviceBrand: undefined;

	constructor(readonly isAcademic: boolean) { }
}
