/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { NewFolderFlowStep } from './newFolderFlowEnums.js';

/**
 * The NewFolderFlowStepProps interface provides the wizard navigation functions
 * to the New Folder Flow steps.
 */
export interface NewFolderFlowStepProps {
	cancel: () => void;
	accept: () => void;
	next: (step: NewFolderFlowStep) => void;
	back: () => void;
}
