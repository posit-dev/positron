/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { PositronModalDialogs } from 'vs/platform/modalDialogs/browser/positronModalDialogs';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IPositronModalDialogsService } from 'vs/platform/modalDialogs/common/positronModalDialogs';

registerSingleton(IPositronModalDialogsService, PositronModalDialogs, InstantiationType.Delayed);
