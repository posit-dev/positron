/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * The part of an output channel this extension writes to.
 *
 * Narrower than the channel itself so that a test can pass something that records what was said:
 * the messages are the behaviour worth asserting on -- an empty completion list and an empty
 * schema look the same from outside and are told apart only by what was logged -- and a fake of
 * the whole channel would be twenty members this extension never calls.
 */
export type SqlLog = Pick<vscode.LogOutputChannel, 'trace' | 'debug' | 'info' | 'warn' | 'error'>;
