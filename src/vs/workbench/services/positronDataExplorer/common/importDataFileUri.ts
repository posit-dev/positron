/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Schemas } from '../../../../base/common/network.js';
import { isEqualAuthority } from '../../../../base/common/resources.js';

/**
 * Whether a file URI names a path the runtime session's machine can open, which is what makes it
 * safe to write that path into generated import code.
 *
 * The session and the extension host that generates the code run on the same machine, so the
 * question is only whether the file lives on that machine too. In a remote window that means the
 * window's own remote; in a local window it means the local disk. A virtual filesystem never
 * qualifies, and neither does a client-local file opened inside a remote window: generating code
 * that silently reads the wrong file (or no file) is worse than generating none.
 *
 * The remote flavor does not matter. Remote SSH, WSL, dev containers, and a browser window served by
 * a remote server all present their files as `vscode-remote` under the window's own authority, so
 * one scheme and authority check covers them all. The path the generated code names comes from
 * `fsPath` evaluated in the extension host, which runs on the remote machine, so it is a path in
 * that machine's own OS convention rather than the client's.
 *
 * @param fileUri The file backing the Data Explorer.
 * @param remoteAuthority The window's remote authority, or undefined in a local window.
 * @returns true if the session can open the file at `fileUri.fsPath`.
 */
export function isSessionVisibleFile(fileUri: URI, remoteAuthority: string | undefined): boolean {
	if (remoteAuthority) {
		return fileUri.scheme === Schemas.vscodeRemote
			&& isEqualAuthority(fileUri.authority, remoteAuthority);
	}
	return fileUri.scheme === Schemas.file;
}
