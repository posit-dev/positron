import type TelemetryReporter from '@vscode/extension-telemetry';

class ReporterImpl {
    private static telemetryReporter: TelemetryReporter | undefined;
    static getTelemetryReporter() {
        const tel = require('@vscode/extension-telemetry');
        const Reporter = tel.default as typeof TelemetryReporter;
        ReporterImpl.telemetryReporter = new Reporter(
            '0c6ae279ed8443289764825290e4f9e2-1a736e7c-1324-4338-be46-fc2a58ae4d14-7255',
            [
                {
                    lookup: /(errorName|errorMessage|errorStack)/g,
                },
            ],
        );

        return ReporterImpl.telemetryReporter;
    }
}

export function getTelemetryReporter() {
    return ReporterImpl.getTelemetryReporter();
}
