/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../base/common/event.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IFileManagedSettingsService, INativeManagedSettingsService, NullFileManagedSettingsService, NullNativeManagedSettingsService } from '../../../../../platform/policy/common/copilotManagedSettings.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { InMemoryStorageService, IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { NullTelemetryService } from '../../../../../platform/telemetry/common/telemetryUtils.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { TestProductService } from '../../../../test/common/workbenchTestServices.js';
import { IAuthenticationAccessService } from '../../../authentication/browser/authenticationAccessService.js';
import { AllowedExtension, IAuthenticationExtensionsService, IAuthenticationService } from '../../../authentication/common/authentication.js';
import { IWorkbenchEnvironmentService } from '../../../environment/common/environmentService.js';
import { IExtensionService } from '../../../extensions/common/extensions.js';
import { IHostService } from '../../../host/browser/host.js';
import { DefaultAccountProvider } from '../../browser/defaultAccount.js';

describe('DefaultAccountProvider Copilot access', () => {
	const updateAllowedExtensions = vi.fn<(providerId: string, accountName: string, extensions: AllowedExtension[]) => void>();

	const ctx = createLightTestContainer()
		.stub(IConfigurationService, new TestConfigurationService())
		.stub(IAuthenticationService, {
			declaredProviders: [],
			isAuthenticationProviderRegistered: () => true,
			getAccounts: async () => [],
			getSessions: async () => [],
			createSession: async (_providerId: string, scopes: readonly string[]) =>
				({ id: 'session', accessToken: 'token', account: { id: 'account', label: 'octocat' }, scopes: [...scopes] }),
			onDidChangeDeclaredProviders: Event.None,
			onDidChangeSessions: Event.None,
			onDidRegisterAuthenticationProvider: Event.None,
			onDidUnregisterAuthenticationProvider: Event.None,
		})
		.stub(IAuthenticationExtensionsService, {
			updateAccountPreference: () => { },
			onDidChangeAccountPreference: Event.None,
		})
		.stub(IAuthenticationAccessService, {
			onDidChangeExtensionSessionAccess: Event.None,
			isAccessAllowed: () => true,
			updateAllowedExtensions,
		})
		.stub(ITelemetryService, NullTelemetryService)
		.stub(IExtensionService, {})
		.stub(IRequestService, {})
		.stub(ILogService, new NullLogService())
		.stub(IWorkbenchEnvironmentService, { remoteAuthority: undefined, isSessionsWindow: false })
		.stub(IProductService, TestProductService)
		.stub(IContextKeyService, new MockContextKeyService())
		.stub(IStorageService, new InMemoryStorageService())
		.stub(IHostService, { hasFocus: true, onDidChangeFocus: Event.None })
		.stub(ICommandService, {})
		.stub(INativeManagedSettingsService, new NullNativeManagedSettingsService())
		.stub(IFileManagedSettingsService, new NullFileManagedSettingsService())
		.build();

	it('gives Copilot access to the account after signing in', async () => {
		const provider = ctx.disposables.add(ctx.instantiationService.createInstance(DefaultAccountProvider, {
			preferredExtensions: [],
			aiExtensionId: 'GitHub.copilot-chat',
			authenticationProvider: {
				default: { id: 'github', name: 'GitHub' },
				enterprise: { id: 'github-enterprise', name: 'GitHub Enterprise' },
				enterpriseProviderConfig: 'github.copilot.advanced.authProvider',
				enterpriseProviderUriSetting: 'github-enterprise.uri',
				scopes: [['read:user', 'user:email', 'repo']],
			},
			tokenEntitlementUrl: '',
			entitlementUrl: '',
			mcpRegistryDataUrl: '',
			managedSettingsUrl: '',
		}));

		await provider.signIn();

		expect(updateAllowedExtensions.mock.calls).toEqual([
			['github', 'octocat', [{ id: 'GitHub.copilot-chat', name: 'GitHub Copilot Chat', allowed: true }]],
		]);
	});
});
