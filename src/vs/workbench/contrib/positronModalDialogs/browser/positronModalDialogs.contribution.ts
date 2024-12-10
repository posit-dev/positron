/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { PositronModalDialogs } from './positronModalDialogs.js';
import { registerPositronModalDialogsActions } from './positronModalDialogsActions.js';
import { IPositronModalDialogsService } from '../../../services/positronModalDialogs/common/positronModalDialogs.js';

registerPositronModalDialogsActions();

registerSingleton(IPositronModalDialogsService, PositronModalDialogs, InstantiationType.Delayed);
