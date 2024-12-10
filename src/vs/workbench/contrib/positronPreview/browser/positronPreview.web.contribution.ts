/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { PositronPreviewService } from './positronPreviewServiceImpl.js';
import { IPositronPreviewService } from './positronPreviewSevice.js';

// Register the Positron preview service.
registerSingleton(IPositronPreviewService, PositronPreviewService, InstantiationType.Delayed);
