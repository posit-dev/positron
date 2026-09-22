# McpClient

An agent connected to a workspace through the stdio bridge

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **number** | Identifies the client within its workspace | [default to undefined]
**name** | **string** | The agent\&#39;s name, from the MCP clientInfo | [optional] [default to undefined]
**version** | **string** | The agent\&#39;s version, from the MCP clientInfo | [optional] [default to undefined]
**pid** | **number** | The process ID of the bridge | [optional] [default to undefined]
**working_directory** | **string** | The bridge\&#39;s working directory, normally the agent\&#39;s | [optional] [default to undefined]
**session_id** | **string** | The session the client is running inside, for a client in a kernel | [optional] [default to undefined]
**connected_at** | **string** | When the client connected | [default to undefined]

## Example

```typescript
import { McpClient } from './api';

const instance: McpClient = {
    id,
    name,
    version,
    pid,
    working_directory,
    session_id,
    connected_at,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
