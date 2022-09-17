/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IModalDialogsService } from 'vs/platform/modalDialogs/common/modalDialogs';
import { ModalDialogs } from 'vs/platform/modalDialogs/browser/modalDialogs';

registerSingleton(IModalDialogsService, ModalDialogs, InstantiationType.Delayed);
