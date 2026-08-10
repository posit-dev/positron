/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Configuration key that gates the Positron Data Connections feature. Shared by
// positronDataConnections.contribution.ts (registers the setting and the view),
// positronDataConnectionsCommands.ts (the command payloads are empty when this is off, so the
// command stays registered and Assistant-side feature-detection is a simple getCommands() check),
// and positronDataConnectionsExecuteCommand.ts (the command's palette/agent precondition).
export const POSITRON_DATA_CONNECTIONS_ENABLED_KEY = 'dataConnections.enabled';
