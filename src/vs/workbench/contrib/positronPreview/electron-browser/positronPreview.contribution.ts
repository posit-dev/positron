/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IPositronPreviewService } from '../browser/positronPreviewSevice.js';
import { ElectronPositronPreviewService } from './positronPreviewServiceImpl.js';

// Register the Electron variant of the Positron preview service.
registerSingleton(IPositronPreviewService, ElectronPositronPreviewService, InstantiationType.Delayed);
