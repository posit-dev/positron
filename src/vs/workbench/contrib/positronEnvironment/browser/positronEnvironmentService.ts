/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronEnvironmentService } from 'vs/workbench/services/positronEnvironment/common/positronEnvironment';

export class PositronEnvironmentService extends Disposable implements IPositronEnvironmentService {

	declare readonly _serviceBrand: undefined;

}
