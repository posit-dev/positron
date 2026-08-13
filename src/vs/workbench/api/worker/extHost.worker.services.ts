/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SyncDescriptor } from '../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { ExtHostAuthentication, IExtHostAuthentication } from '../common/extHostAuthentication.js';
import { IExtHostExtensionService } from '../common/extHostExtensionService.js';
import { ExtHostLogService } from '../common/extHostLogService.js';
import { ExtensionStoragePaths, IExtensionStoragePaths } from '../common/extHostStoragePaths.js';
import { ExtHostTelemetry, IExtHostTelemetry } from '../common/extHostTelemetry.js';
import { ExtHostExtensionService } from './extHostExtensionService.js';
// --- Start Positron ---
import { IExtHostDocs, WorkerExtHostDocs } from '../common/positron/extHostDocs.js';
// --- End Positron ---

// #########################################################################
// ###                                                                   ###
// ### !!! PLEASE ADD COMMON IMPORTS INTO extHost.common.services.ts !!! ###
// ###                                                                   ###
// #########################################################################

registerSingleton(ILogService, new SyncDescriptor(ExtHostLogService, [true], true));
registerSingleton(IExtHostAuthentication, ExtHostAuthentication, InstantiationType.Eager);
registerSingleton(IExtHostExtensionService, ExtHostExtensionService, InstantiationType.Eager);
registerSingleton(IExtensionStoragePaths, ExtensionStoragePaths, InstantiationType.Eager);
registerSingleton(IExtHostTelemetry, new SyncDescriptor(ExtHostTelemetry, [true], true));

// --- Start Positron ---
// The Positron API factory runs in this host too, so positron.docs needs a
// registration here. The worker host has no filesystem, so it gets the
// always-undefined variant.
registerSingleton(IExtHostDocs, WorkerExtHostDocs, InstantiationType.Eager);
// --- End Positron ---
