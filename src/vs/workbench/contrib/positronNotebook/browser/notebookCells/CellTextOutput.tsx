/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./CellTextOutput';

import * as React from 'react';
import { ANSIOutput } from 'vs/base/common/ansiOutput';
import { OutputLines } from 'vs/workbench/browser/positronAnsiRenderer/outputLines';
import { useServices } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';
import { ParsedTextOutput } from 'vs/workbench/contrib/positronNotebook/browser/getOutputContents';

export function CellTextOutput({ content, type }: ParsedTextOutput) {

	const { openerService, notificationService } = useServices();

	const processedAnsi = ANSIOutput.processOutput(content);

	return <div className={`notebook-${type} positron-notebook-text-output`}>
		<OutputLines
			outputLines={processedAnsi}
			openerService={openerService}
			notificationService={notificationService} />
	</div>;
}
