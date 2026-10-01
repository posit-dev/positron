/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IDialogService, IPrompt, IPromptResult, IPromptResultWithCancel, IPromptWithCustomCancel, IPromptWithDefaultCancel } from '../../../../platform/dialogs/common/dialogs.js';
import { TestDialogService } from '../../../../platform/dialogs/test/common/testDialogService.js';
import { TestInstantiationService } from '../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../platform/notification/test/common/testNotificationService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { NullTelemetryService } from '../../../../platform/telemetry/common/telemetryUtils.js';
import { MainThreadAuthentication } from '../../browser/mainThreadAuthentication.js';
import { ExtHostContext, MainContext } from '../../common/extHost.protocol.js';
import { IActivityService } from '../../../services/activity/common/activity.js';
import { AuthenticationService } from '../../../services/authentication/browser/authenticationService.js';
import { IAuthenticationExtensionsService, IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IRemoteAgentService } from '../../../services/remote/common/remoteAgentService.js';
import { TestRPCProtocol } from '../common/testRPCProtocol.js';
import { TestEnvironmentService, TestHostService, TestQuickInputService, TestRemoteAgentService } from '../../../test/browser/workbenchTestServices.js';
import { TestActivityService, TestExtensionService, TestProductService, TestStorageService } from '../../../test/common/workbenchTestServices.js';
import { IBrowserWorkbenchEnvironmentService } from '../../../services/environment/browser/environmentService.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { AuthenticationAccessService, IAuthenticationAccessService } from '../../../services/authentication/browser/authenticationAccessService.js';
import { IAccountUsage, IAuthenticationUsageService } from '../../../services/authentication/browser/authenticationUsageService.js';
import { AuthenticationExtensionsService } from '../../../services/authentication/browser/authenticationExtensionsService.js';
import { ILogService, NullLogService } from '../../../../platform/log/common/log.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IUserActivityService, UserActivityService } from '../../../services/userActivity/common/userActivityService.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { TestSecretStorageService } from '../../../../platform/secrets/test/common/testSecretStorageService.js';
import { IDynamicAuthenticationProviderStorageService } from '../../../services/authentication/common/dynamicAuthenticationProviderStorage.js';
import { DynamicAuthenticationProviderStorageService } from '../../../services/authentication/browser/dynamicAuthenticationProviderStorageService.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';

class TestAuthUsageService implements IAuthenticationUsageService {
	_serviceBrand: undefined;
	initializeExtensionUsageCache(): Promise<void> { return Promise.resolve(); }
	extensionUsesAuth(extensionId: string): Promise<boolean> { return Promise.resolve(false); }
	readAccountUsages(providerId: string, accountName: string): IAccountUsage[] { return []; }
	removeAccountUsage(providerId: string, accountName: string): void { }
	addAccountUsage(providerId: string, accountName: string, scopes: ReadonlyArray<string>, extensionId: string, extensionName: string): void { }
}

// --- Start Positron ---
/** Records whether the login-consent dialog was ever shown, always allowing it. */
class RecordingDialogService extends TestDialogService {
	promptCallCount = 0;
	override prompt<T>(prompt: IPromptWithCustomCancel<T>): Promise<IPromptResultWithCancel<T>>;
	override prompt<T>(prompt: IPromptWithDefaultCancel<T>): Promise<IPromptResult<T>>;
	override prompt<T>(prompt: IPrompt<T>): Promise<IPromptResult<T>>;
	override async prompt<T>(prompt: IPrompt<T> | IPromptWithCustomCancel<T>): Promise<IPromptResult<T> | IPromptResultWithCancel<T>> {
		this.promptCallCount++;
		return super.prompt(prompt as IPrompt<T>);
	}
}

/**
 * Builds an isolated {@link MainThreadAuthentication} instance. Extracted from the suite's
 * `setup()` so a test can override `dialogService`/`productService` and get its own instance
 * with fresh DI wiring -- services are resolved at construction time, so stubbing them on an
 * already-built instance's collection has no effect on it.
 */
function createMainThreadAuthentication(
	disposables: Pick<DisposableStore, 'add'>,
	overrides?: { dialogService?: IDialogService; productService?: IProductService },
): { mainThreadAuthentication: MainThreadAuthentication; instantiationService: TestInstantiationService; rpcProtocol: TestRPCProtocol } {
	// --- End Positron ---
	// services
	const services = new ServiceCollection();
	services.set(ILogService, new SyncDescriptor(NullLogService));
	services.set(IDialogService, new SyncDescriptor(TestDialogService, [{ confirmed: true }]));
	services.set(IStorageService, new SyncDescriptor(TestStorageService));
	services.set(ISecretStorageService, new SyncDescriptor(TestSecretStorageService));
	services.set(IDynamicAuthenticationProviderStorageService, new SyncDescriptor(DynamicAuthenticationProviderStorageService));
	services.set(IQuickInputService, new SyncDescriptor(TestQuickInputService));
	services.set(IExtensionService, new SyncDescriptor(TestExtensionService));
	services.set(IActivityService, new SyncDescriptor(TestActivityService));
	services.set(IRemoteAgentService, new SyncDescriptor(TestRemoteAgentService));
	services.set(INotificationService, new SyncDescriptor(TestNotificationService));
	services.set(IHostService, new SyncDescriptor(TestHostService));
	services.set(IUserActivityService, new SyncDescriptor(UserActivityService));
	services.set(IAuthenticationAccessService, new SyncDescriptor(AuthenticationAccessService));
	services.set(IAuthenticationService, new SyncDescriptor(AuthenticationService));
	services.set(IAuthenticationUsageService, new SyncDescriptor(TestAuthUsageService));
	services.set(IAuthenticationExtensionsService, new SyncDescriptor(AuthenticationExtensionsService));
	const instantiationService = disposables.add(new TestInstantiationService(services, undefined, undefined, true));

	// stubs
	// eslint-disable-next-line local/code-no-dangerous-type-assertions
	instantiationService.stub(IOpenerService, {} as Partial<IOpenerService>);
	instantiationService.stub(ITelemetryService, NullTelemetryService);
	instantiationService.stub(IBrowserWorkbenchEnvironmentService, TestEnvironmentService);
	instantiationService.stub(IProductService, overrides?.productService ?? TestProductService);
	// --- Start Positron ---
	if (overrides?.dialogService) {
		instantiationService.stub(IDialogService, overrides.dialogService);
	}
	// --- End Positron ---

	const rpcProtocol = disposables.add(new TestRPCProtocol());
	const mainThreadAuthentication = disposables.add(instantiationService.createInstance(MainThreadAuthentication, rpcProtocol));
	rpcProtocol.set(MainContext.MainThreadAuthentication, mainThreadAuthentication);
	return { mainThreadAuthentication, instantiationService, rpcProtocol };
}

suite('MainThreadAuthentication', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let mainThreadAuthentication: MainThreadAuthentication;
	let rpcProtocol: TestRPCProtocol;

	setup(async () => {
		({ mainThreadAuthentication, rpcProtocol } = createMainThreadAuthentication(disposables));
	});

	test('provider registration completes without errors', async () => {
		// Test basic registration - this should complete without throwing
		await mainThreadAuthentication.$registerAuthenticationProvider({
			id: 'test-provider',
			label: 'Test Provider',
			supportsMultipleAccounts: false
		});

		// Test unregistration - this should also complete without throwing
		await mainThreadAuthentication.$unregisterAuthenticationProvider('test-provider');

		// Success if we reach here without timeout
		assert.ok(true, 'Registration and unregistration completed successfully');
	});

	test('event suppression during explicit unregistration', async () => {
		let unregisterEventFired = false;
		let eventProviderId: string | undefined;

		// Mock the ext host to capture unregister events
		const mockExtHost = {
			$onDidUnregisterAuthenticationProvider: (id: string) => {
				unregisterEventFired = true;
				eventProviderId = id;
				return Promise.resolve();
			},
			$getSessions: () => Promise.resolve([]),
			// eslint-disable-next-line local/code-no-any-casts
			$createSession: () => Promise.resolve({} as any),
			$removeSession: () => Promise.resolve(),
			$onDidChangeAuthenticationSessions: () => Promise.resolve(),
			$registerDynamicAuthProvider: () => Promise.resolve('test'),
			$registerXaaAuthProvider: () => Promise.resolve('test'),
			$onDidChangeDynamicAuthProviderTokens: () => Promise.resolve(),
			$getSessionsFromChallenges: () => Promise.resolve([]),
			// eslint-disable-next-line local/code-no-any-casts
			$createSessionFromChallenges: () => Promise.resolve({} as any),
		};
		rpcProtocol.set(ExtHostContext.ExtHostAuthentication, mockExtHost);

		// Register a provider
		await mainThreadAuthentication.$registerAuthenticationProvider({
			id: 'test-suppress',
			label: 'Test Suppress',
			supportsMultipleAccounts: false
		});

		// Reset the flag
		unregisterEventFired = false;
		eventProviderId = undefined;

		// Unregister the provider - this should NOT fire the event due to suppression
		await mainThreadAuthentication.$unregisterAuthenticationProvider('test-suppress');

		// Verify the event was suppressed
		assert.strictEqual(unregisterEventFired, false, 'Unregister event should be suppressed during explicit unregistration');
		assert.strictEqual(eventProviderId, undefined, 'No provider ID should be captured from suppressed event');
	});

	test('concurrent provider registrations complete without errors', async () => {
		// Register multiple providers simultaneously
		const registrationPromises = [
			mainThreadAuthentication.$registerAuthenticationProvider({
				id: 'concurrent-1',
				label: 'Concurrent 1',
				supportsMultipleAccounts: false
			}),
			mainThreadAuthentication.$registerAuthenticationProvider({
				id: 'concurrent-2',
				label: 'Concurrent 2',
				supportsMultipleAccounts: false
			}),
			mainThreadAuthentication.$registerAuthenticationProvider({
				id: 'concurrent-3',
				label: 'Concurrent 3',
				supportsMultipleAccounts: false
			})
		];

		await Promise.all(registrationPromises);

		// Unregister all providers
		const unregistrationPromises = [
			mainThreadAuthentication.$unregisterAuthenticationProvider('concurrent-1'),
			mainThreadAuthentication.$unregisterAuthenticationProvider('concurrent-2'),
			mainThreadAuthentication.$unregisterAuthenticationProvider('concurrent-3')
		];

		await Promise.all(unregistrationPromises);

		// Success if we reach here without timeout
		assert.ok(true, 'Concurrent registrations and unregistrations completed successfully');
	});
});

// --- Start Positron ---
// A sibling suite, not nested in 'MainThreadAuthentication': that suite's setup() already
// builds one MainThreadAuthentication/AuthenticationService per test, and AuthenticationService
// registers a process-wide singleton handler for the 'authentication' extension point, so a
// second instance built inside one of its tests collides ("Handler already set"). Each test here
// builds its own single instance instead.
suite('MainThreadAuthentication createIfNone trust', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const providerId = 'trust-test-provider';
	const extensionId = 'test.extension';

	function mockExtHostFor(rpc: TestRPCProtocol) {
		const mockExtHost = {
			$onDidUnregisterAuthenticationProvider: () => Promise.resolve(),
			$getSessions: () => Promise.resolve([]),
			$createSession: () => Promise.resolve({
				id: 'session-1',
				accessToken: 'token',
				account: { id: 'account-1', label: 'Account 1' },
				scopes: [],
			}),
			$removeSession: () => Promise.resolve(),
			$onDidChangeAuthenticationSessions: () => Promise.resolve(),
			$registerDynamicAuthProvider: () => Promise.resolve('test'),
			$registerXaaAuthProvider: () => Promise.resolve('test'),
			$onDidChangeDynamicAuthProviderTokens: () => Promise.resolve(),
			$getSessionsFromChallenges: () => Promise.resolve([]),
			// eslint-disable-next-line local/code-no-any-casts
			$createSessionFromChallenges: () => Promise.resolve({} as any),
		};
		rpc.set(ExtHostContext.ExtHostAuthentication, mockExtHost);
	}

	test('shows the consent dialog for an untrusted extension creating a new session', async () => {
		const dialogService = new RecordingDialogService({ confirmed: true });
		const { mainThreadAuthentication: mta, rpcProtocol: rpc } = createMainThreadAuthentication(disposables, { dialogService });
		mockExtHostFor(rpc);

		await mta.$registerAuthenticationProvider({ id: providerId, label: 'Trust Test Provider', supportsMultipleAccounts: false });
		await mta.$getSession(providerId, [], extensionId, 'Test Extension', { createIfNone: true });

		assert.strictEqual(dialogService.promptCallCount, 1, 'expected the consent dialog to be shown once');
	});

	test('skips the consent dialog when product.json trusts the extension for this provider', async () => {
		const dialogService = new RecordingDialogService({ confirmed: true });
		const productService = { ...TestProductService, trustedExtensionAuthAccess: { [providerId]: [extensionId] } };
		const { mainThreadAuthentication: mta, rpcProtocol: rpc } = createMainThreadAuthentication(disposables, { dialogService, productService });
		mockExtHostFor(rpc);

		await mta.$registerAuthenticationProvider({ id: providerId, label: 'Trust Test Provider', supportsMultipleAccounts: false });
		await mta.$getSession(providerId, [], extensionId, 'Test Extension', { createIfNone: true });

		assert.strictEqual(dialogService.promptCallCount, 0, 'expected the consent dialog to be skipped for a trusted extension');
	});
});
// --- End Positron ---
