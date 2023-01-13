/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronHistoryService } from 'vs/workbench/services/positronHistory/common/positronHistory';

export class PositronHistoryService extends Disposable implements IPositronHistoryService {
	declare readonly _serviceBrand: undefined;
}
