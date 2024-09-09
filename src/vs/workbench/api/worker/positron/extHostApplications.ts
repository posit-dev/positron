/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotSupportedError } from 'vs/base/common/errors';
import { AbstractExtHostApplications } from 'vs/workbench/api/common/positron/extHostApplications';

export class ExtHostApplications extends AbstractExtHostApplications {
	protected override findFreePort(startPort: number, maxTries: number, timeout: number): Promise<number> {
		throw new NotSupportedError();
	}

	protected override waitForPortConnection(port: number, timeout: number): Promise<void> {
		throw new NotSupportedError();
	}
}
