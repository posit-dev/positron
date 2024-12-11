/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IPositronNotebookOutputWebviewService } from './notebookOutputWebviewService.js';
import { PositronNotebookOutputWebviewService } from './notebookOutputWebviewServiceImpl.js';

registerSingleton(IPositronNotebookOutputWebviewService,
	PositronNotebookOutputWebviewService,
	InstantiationType.Delayed);
