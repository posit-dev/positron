/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';
import { OutputLines } from '../../../../browser/positronAnsiRenderer/outputLines.js';

// ConsoleOutputLinesProps interface.
export interface ConsoleOutputLinesProps {
	readonly outputLines: readonly ANSIOutputLine[];
}

/**
 * A remap of the `OutputLines` component that gets the services from the console context. Done to
 * avoid having to prop-drill the services every place we use `OutputLines` in the console. (A lot
 * of places.)
 * @param props A OutputLinesProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleOutputLines = (props: ConsoleOutputLinesProps) => {
	// Render.
	return <OutputLines {...props} />;
};
