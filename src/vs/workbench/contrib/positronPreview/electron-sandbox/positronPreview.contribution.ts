/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IPositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';
import { ElectronPositronPreviewService } from 'vs/workbench/contrib/positronPreview/electron-sandbox/positronPreviewServiceImpl';

// Register the Electron variant of the Positron preview service.
registerSingleton(IPositronPreviewService, ElectronPositronPreviewService, InstantiationType.Delayed);
