// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { injectable, unmanaged } from 'inversify';
import { DiagnosticSeverity } from 'vscode';
import { Resource } from '../../common/types';
import { IServiceContainer } from '../../ioc/types';
import { sendTelemetryEvent } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
import { DiagnosticCodes } from './constants';
import { DiagnosticScope, IDiagnostic, IDiagnosticFilterService, IDiagnosticsService } from './types';

@injectable()
export abstract class BaseDiagnostic implements IDiagnostic {
    constructor(public readonly code: DiagnosticCodes, public readonly message: string,
        public readonly severity: DiagnosticSeverity, public readonly scope: DiagnosticScope,
        public readonly resource: Resource) { }
}

@injectable()
export abstract class BaseDiagnosticsService implements IDiagnosticsService {
    protected readonly filterService: IDiagnosticFilterService;
    constructor(@unmanaged() private readonly supportedDiagnosticCodes: string[],
        @unmanaged() protected serviceContainer: IServiceContainer) {
        this.filterService = serviceContainer.get<IDiagnosticFilterService>(IDiagnosticFilterService);
    }
    public abstract diagnose(resource: Resource): Promise<IDiagnostic[]>;
    public abstract handle(diagnostics: IDiagnostic[]): Promise<void>;
    public async canHandle(diagnostic: IDiagnostic): Promise<boolean> {
        sendTelemetryEvent(EventName.DIAGNOSTICS_MESSAGE, undefined, { code: diagnostic.code });
        return this.supportedDiagnosticCodes.filter(item => item === diagnostic.code).length > 0;
    }
}
