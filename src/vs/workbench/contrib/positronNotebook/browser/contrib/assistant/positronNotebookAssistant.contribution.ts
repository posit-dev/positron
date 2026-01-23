/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerPositronNotebookContribution } from '../../positronNotebookExtensions.js';
import { PositronNotebookAssistantController } from './controller.js';

registerPositronNotebookContribution(PositronNotebookAssistantController.ID, PositronNotebookAssistantController);
