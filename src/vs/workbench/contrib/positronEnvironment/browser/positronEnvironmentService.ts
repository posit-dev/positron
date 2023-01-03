/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronEnvironmentService } from 'vs/workbench/services/positronEnvironment/common/positronEnvironment';

/**
 * PositronEnvironmentService class.
 */
export class PositronEnvironmentService extends Disposable implements IPositronEnvironmentService {
	/** Needed for service branding in dependency injector. */
	declare readonly _serviceBrand: undefined;
}
