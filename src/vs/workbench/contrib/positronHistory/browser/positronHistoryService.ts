/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronHistoryService } from 'vs/workbench/services/positronHistory/common/positronHistory';

export class PositronHistoryService extends Disposable implements IPositronHistoryService {
	declare readonly _serviceBrand: undefined;
}
