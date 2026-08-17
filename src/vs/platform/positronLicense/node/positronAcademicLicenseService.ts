/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronAcademicLicenseService } from '../common/positronAcademicLicenseService.js';

/**
 * Takes the academic status as a plain constructor value: on the server it comes from an
 * async license check that completes before services are registered (see `createServer()`
 * in `remoteExtensionHostAgentServer.ts`); processes with no license check pass `false`.
 */
export class PositronAcademicLicenseService implements IPositronAcademicLicenseService {
	declare readonly _serviceBrand: undefined;

	constructor(readonly isAcademic: boolean) { }
}
