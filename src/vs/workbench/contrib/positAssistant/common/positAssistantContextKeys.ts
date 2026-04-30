/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

/**
 * The id of the Posit Assistant extension. Posit Assistant is the optional
 * successor to the built-in Positron Assistant.
 */
export const POSIT_ASSISTANT_EXTENSION_ID = 'posit.assistant';

/**
 * Context key that is `true` when the Posit Assistant extension is installed
 * and enabled in the current workbench. Used to gate Posit-Assistant-flavored
 * UI (notebook actions, layout) so it only appears when the optional extension
 * is present.
 */
export const POSIT_ASSISTANT_AVAILABLE = new RawContextKey<boolean>('positron.positAssistantAvailable', false);
