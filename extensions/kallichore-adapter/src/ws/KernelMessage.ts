/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { SocketMessage } from './SocketMessage';

/**
 * Represents a status message from the kernel.
 */
export interface KernelMessageStatus extends SocketMessage {
	status: string;
}

