/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMermaidRenderService } from './mermaidRenderService.js';
import { MermaidWebviewRenderService } from './mermaidWebviewRenderService.js';

registerSingleton(IMermaidRenderService, MermaidWebviewRenderService, InstantiationType.Delayed);
