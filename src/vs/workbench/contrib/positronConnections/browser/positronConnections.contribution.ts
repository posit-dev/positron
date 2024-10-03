/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { WorkbenchPhase, registerWorkbenchContribution2 } from 'vs/workbench/common/contributions';

/**
 * PositronDataExplorerContribution class.
 */
class PositronConnectionsContribution extends Disposable {
	static readonly ID = 'workbench.contrib.positronConnections';
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
	}
}
// Register workbench contribution.
registerWorkbenchContribution2(
	PositronConnectionsContribution.ID,
	PositronConnectionsContribution,
	WorkbenchPhase.BlockRestore
);
