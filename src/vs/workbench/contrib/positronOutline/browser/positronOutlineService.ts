/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronOutlineService } from 'vs/workbench/services/positronOutline/common/positronOutline';

export class PositronOutlineService extends Disposable implements IPositronOutlineService {

	declare readonly _serviceBrand: undefined;

}
