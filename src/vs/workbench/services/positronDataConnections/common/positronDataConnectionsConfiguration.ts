/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Configuration key that switches between the Positron Data Connections feature (true) and the older
// Connections pane (false). Lives in the services layer so both services and contributions can read it.
export const POSITRON_DATA_CONNECTIONS_ENABLED_KEY = 'dataConnections.enabled';
