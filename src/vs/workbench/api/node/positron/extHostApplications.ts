/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { findFreePort, waitForPortConnection } from 'vs/base/node/ports';
import { AbstractExtHostApplications } from 'vs/workbench/api/common/positron/extHostApplications';

export class ExtHostApplications extends AbstractExtHostApplications {
	protected override findFreePort(startPort: number, maxTries: number, timeout: number): Promise<number> {
		return findFreePort(startPort, maxTries, timeout);
	}

	protected override waitForPortConnection(port: number, timeout: number): Promise<void> {
		return waitForPortConnection(port, timeout);
	}
}
