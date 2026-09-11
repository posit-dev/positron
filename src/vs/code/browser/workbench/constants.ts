/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// port tokens for generating secure URLs
export const kPortToken = process.env.RS_PORT_TOKEN !== undefined ? process.env.RS_PORT_TOKEN : '';
