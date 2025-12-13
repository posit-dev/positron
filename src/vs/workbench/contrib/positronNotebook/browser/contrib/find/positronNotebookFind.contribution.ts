/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Register find actions
import './actions.js';

import { registerPositronNotebookContribution } from '../../positronNotebookExtensions.js';
import { PositronNotebookFindController } from './controller.js';

registerPositronNotebookContribution(PositronNotebookFindController.ID, PositronNotebookFindController);
