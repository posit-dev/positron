import type { IEventNamePropertyMapping } from './constants';
import { StopWatch } from '../stopWatch';
import { isTestExecution } from '../utils/testing';
import { getTelemetryReporter } from './reporter';
import { isPromise } from 'util/types';

type FailedEventType = { failed: true };

function isTelemetrySupported(): boolean {
    try {
        const vsc = require('vscode');
        const reporter = require('@vscode/extension-telemetry');
        return !!vsc && !!reporter;
    } catch {
        return false;
    }
}

export function sendTelemetryEvent<P extends IEventNamePropertyMapping, E extends keyof P>(
    eventName: E,
    measuresOrDurationMs?: Record<string, number> | number,
    properties?: P[E],
    ex?: Error,
): void {
    if (isTestExecution() || !isTelemetrySupported()) {
        return;
    }
    const reporter = getTelemetryReporter();
    const measures =
        typeof measuresOrDurationMs === 'number' ? { duration: measuresOrDurationMs } : measuresOrDurationMs;

    const customProperties: Record<string, string> = {};
    const eventNameSent = eventName as string;

    if (properties) {
        const data = properties as Record<string, unknown>;
        Object.entries(data).forEach(([prop, value]) => {
            if (value === null || value === undefined) {
                return;
            }

            try {
                customProperties[prop] = typeof value === 'object' ? 'object' : String(value);
            } catch (exception) {
                console.error(`Failed to serialize ${prop} for ${String(eventName)}`, exception);
            }
        });
    }

    if (ex) {
        const errorProps = {
            errorName: ex.name,
            errorStack: ex.stack ?? '',
        };
        Object.assign(customProperties, errorProps);
        reporter.sendTelemetryErrorEvent(eventNameSent, customProperties, measures);
    } else {
        reporter.sendTelemetryEvent(eventNameSent, customProperties, measures);
    }
}

type TypedMethodDescriptor<T> = (
    target: unknown,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
) => TypedPropertyDescriptor<T> | void;

export function captureTelemetry<This, P extends IEventNamePropertyMapping, E extends keyof P>(
    eventName: E,
    properties?: P[E],
    captureDuration = true,
    failureEventName?: E,
    lazyProperties?: (obj: This, result?: unknown) => P[E],
    lazyMeasures?: (obj: This, result?: unknown) => Record<string, number>,
): TypedMethodDescriptor<(this: This, ...args: unknown[]) => unknown> {
    return function (
        _target: unknown,
        _propertyKey: string | symbol,
        descriptor: TypedPropertyDescriptor<(this: This, ...args: unknown[]) => unknown>,
    ) {
        const originalMethod = descriptor.value!;

        descriptor.value = function (this: This, ...args: unknown[]) {
            if (!captureDuration && !lazyProperties && !lazyMeasures) {
                sendTelemetryEvent(eventName, undefined, properties);
                return originalMethod.apply(this, args);
            }

            const getProps = (result?: unknown) =>
                lazyProperties ? { ...properties, ...lazyProperties(this, result) } : properties;
            const stopWatch = captureDuration ? new StopWatch() : undefined;
            const getMeasures = (result?: unknown) => {
                const measures = stopWatch ? { duration: stopWatch.elapsedTime } : undefined;
                return lazyMeasures ? { ...measures, ...lazyMeasures(this, result) } : measures;
            };

            const result = originalMethod.apply(this, args);

            if (result && isPromise(result)) {
                return result
                    .then((data) => {
                        sendTelemetryEvent(eventName, getMeasures(data), getProps(data));
                        return data;
                    })
                    .catch((ex) => {
                        const failedProps: P[E] = { ...getProps(), failed: true } as P[E] & FailedEventType;
                        sendTelemetryEvent(failureEventName || eventName, getMeasures(), failedProps, ex);
                        return Promise.reject(ex);
                    });
            } else {
                sendTelemetryEvent(eventName, getMeasures(result), getProps(result));
                return result;
            }
        };

        return descriptor;
    };
}

export function sendTelemetryWhenDone<P extends IEventNamePropertyMapping, E extends keyof P>(
    eventName: E,
    promise: Promise<unknown> | Thenable<unknown>,
    stopWatch: StopWatch = new StopWatch(),
    properties?: P[E],
): void {
    if (typeof promise.then === 'function') {
        promise.then(
            (data) => {
                sendTelemetryEvent(eventName, stopWatch.elapsedTime, properties);
                return data;
            },
            (ex) => {
                sendTelemetryEvent(eventName, stopWatch.elapsedTime, properties, ex);
                return Promise.reject(ex);
            },
        );
    } else {
        throw new Error('Method is neither a Promise nor a Thenable');
    }
}
