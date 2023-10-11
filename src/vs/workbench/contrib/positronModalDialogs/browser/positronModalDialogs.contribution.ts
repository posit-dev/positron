/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { PositronModalDialogs } from 'vs/workbench/contrib/positronModalDialogs/browser/positronModalDialogs';
import { IPositronModalDialogsService } from 'vs/workbench/services/positronModalDialogs/common/positronModalDialogs';

registerSingleton(IPositronModalDialogsService, PositronModalDialogs, InstantiationType.Delayed);
