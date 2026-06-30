/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { PositronMcpLifecycleContribution } from './positronMcpLifecycleContribution.js';

registerWorkbenchContribution2('positronMcpLifecycle', PositronMcpLifecycleContribution, WorkbenchPhase.AfterRestored);
