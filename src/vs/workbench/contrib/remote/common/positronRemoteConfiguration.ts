/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

/**
 * The unified setting key for the URL that the Positron server (reh) is downloaded from.
 *
 * The remote extensions (SSH, WSL, and Dev Containers) each declared their own copy of
 * this setting. Those copies are deprecated but still honored. This key is registered in
 * core rather than in one of those extensions so that it exists even when a given remote
 * extension is disabled or not installed.
 *
 * The default is deliberately empty. An empty value means "not set", which is what lets
 * the extensions fall through to `serverDownloadUrlTemplate` in `product.json`. Defaulting
 * to the CDN URL instead would make an unset setting indistinguishable from a deliberate
 * choice, and local and dev builds would lose their own default.
 */
export const REMOTE_SERVER_DOWNLOAD_URL_TEMPLATE_KEY = 'remote.serverDownloadUrlTemplate';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerConfiguration({
		id: 'remote',
		title: localize('positron.remote', "Remote"),
		type: 'object',
		properties: {
			[REMOTE_SERVER_DOWNLOAD_URL_TEMPLATE_KEY]: {
				type: 'string',
				default: '',
				scope: ConfigurationScope.APPLICATION,
				markdownDescription: localize('positron.remote.serverDownloadUrlTemplate', "The URL that the Positron server is downloaded from when you connect to a remote over SSH, WSL, or a dev container. Leave this empty to use the URL that this build was published with, for example, `https://cdn.posit.co/positron/${quality}/reh/${arch-long}/positron-reh-${os}-${arch}-${version}.tar.gz`. These variables are replaced when the URL is built:\n- `${quality}`: server quality, for example `stable` or `dailies`\n- `${version}`: server version, for example `2024.10.0-123`\n- `${commit}`: server release commit\n- `${os}`: server operating system, for example `linux`, `darwin`, or `win32`\n- `${arch}`: server architecture, for example `x64`, `armhf`, or `arm64`\n- `${arch-long}`: server architecture in long form, for example `x86_64` or `arm64`")
			}
		}
	});
