/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Configuration key that selects the Data Connections feature when exactly true, and the older
// Connections pane for any other value. Lives in the services layer so services can import it too.
export const POSITRON_DATA_CONNECTIONS_ENABLED_KEY = 'dataConnections.enabled';
