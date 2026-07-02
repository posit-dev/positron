/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ILogger } from '../../log/common/log.js';
import { McpAuditEvent, McpAuditLogDetail, toJsonlRecord } from '../common/positronMcpAudit.js';

/**
 * The JSONL audit-file sink: one JSON event per line, appended to a single file
 * in the logs directory for the life of this Positron session. The file is the
 * power-user record of what agents did -- greppable, jq-able, diffable against
 * an agent transcript -- and is cleaned up with the session logs it sits next
 * to. What each line carries is governed by {@link detail} at write time, so a
 * setting change applies to the next event without a restart.
 *
 * The append stream opens lazily on the first persisted event: with the detail
 * set to 'off' (or no MCP activity at all) no file ever appears. A stream error
 * (disk full, permissions) is logged once and the sink goes quiet rather than
 * failing the tool call that triggered the write.
 */
export class McpAuditFileWriter extends Disposable {
	private _stream: fs.WriteStream | undefined;
	private _failed = false;

	/** The capture policy applied to the next write. */
	detail: McpAuditLogDetail = 'summary';

	constructor(
		private readonly _filePath: string,
		private readonly _logger: ILogger,
	) {
		super();
	}

	/** The audit file's path once something has been written to it, else undefined. */
	get path(): string | undefined {
		return this._stream && !this._failed ? this._filePath : undefined;
	}

	write(event: McpAuditEvent): void {
		const line = toJsonlRecord(event, this.detail);
		if (line === undefined || this._failed) {
			return;
		}
		if (!this._stream) {
			this._stream = fs.createWriteStream(this._filePath, { flags: 'a' });
			this._stream.on('error', (error: Error) => {
				this._logger.error(`[PositronMcpServer] Audit file ${this._filePath} is not writable; audit-file logging disabled: ${error.message}`);
				this._failed = true;
			});
		}
		this._stream.write(line + '\n');
	}

	override dispose(): void {
		this._stream?.end();
		this._stream = undefined;
		super.dispose();
	}
}
