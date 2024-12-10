/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IPositronHistoryService } from '../../../services/positronHistory/common/positronHistory.js';

export class PositronHistoryService extends Disposable implements IPositronHistoryService {
	declare readonly _serviceBrand: undefined;
}
