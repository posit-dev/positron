/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { PositronModalDialogs } from 'vs/workbench/contrib/positronModalDialogs/browser/positronModalDialogs';
import { IPositronModalDialogsService } from 'vs/workbench/services/positronModalDialogs/browser/positronModalDialogs';

registerSingleton(IPositronModalDialogsService, PositronModalDialogs, InstantiationType.Delayed);
