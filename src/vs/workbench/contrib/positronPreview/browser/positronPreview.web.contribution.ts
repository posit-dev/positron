/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { PositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewServiceImpl';
import { IPositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';

// Register the Positron preview service.
registerSingleton(IPositronPreviewService, PositronPreviewService, InstantiationType.Delayed);
