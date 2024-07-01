/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronHistoryService } from 'vs/workbench/services/positronHistory/common/positronHistory';

export class PositronHistoryService extends Disposable implements IPositronHistoryService {
	declare readonly _serviceBrand: undefined;
}
