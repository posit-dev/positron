/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { PositronModalDialogs } from 'vs/platform/positronModalDialogs/browser/positronModalDialogs';
import { IPositronModalDialogsService } from 'vs/platform/positronModalDialogs/common/positronModalDialogs';

registerSingleton(IPositronModalDialogsService, PositronModalDialogs, InstantiationType.Delayed);
