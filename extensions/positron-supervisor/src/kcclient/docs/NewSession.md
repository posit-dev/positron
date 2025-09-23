# NewSession


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**session_id** | **string** | A unique identifier for the session | [default to undefined]
**display_name** | **string** | A human-readable name for the session | [default to undefined]
**language** | **string** | The interpreter language | [default to undefined]
**username** | **string** | The username of the user who owns the session | [default to undefined]
**input_prompt** | **string** | The text to use to prompt for input | [default to undefined]
**continuation_prompt** | **string** | The text to use to prompt for input continuations | [default to undefined]
**argv** | **Array&lt;string&gt;** | The program and command-line parameters for the session | [default to undefined]
**working_directory** | **string** | The working directory in which to start the session. | [default to undefined]
**env** | [**Array&lt;VarAction&gt;**](VarAction.md) | A list of environment variable actions to perform | [default to undefined]
**connection_timeout** | **number** | The number of seconds to wait for a connection to the session\&#39;s ZeroMQ sockets before timing out | [optional] [default to 30]
**interrupt_mode** | [**InterruptMode**](InterruptMode.md) |  | [default to undefined]
**protocol_version** | **string** | The Jupyter protocol version supported by the underlying kernel | [optional] [default to '5.3']
**run_in_shell** | **boolean** | Whether to run the session inside a login shell; only relevant on POSIX systems | [optional] [default to false]

## Example

```typescript
import { NewSession } from './api';

const instance: NewSession = {
    session_id,
    display_name,
    language,
    username,
    input_prompt,
    continuation_prompt,
    argv,
    working_directory,
    env,
    connection_timeout,
    interrupt_mode,
    protocol_version,
    run_in_shell,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
