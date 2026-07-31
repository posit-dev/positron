Addresses https://github.com/posit-dev/positron/issues/10459

`RuntimeNotebookCellExecution` subscribed to every runtime message type except clear_output, so `IPython.display.clear_output()` was never consumed and outputs accumulated instead of clearing - in both notebook editors, which share this kernel. This PR subscribes to the session's clear_output event and implements Jupyter semantics:

- `clear_output(wait=False)`: clears the cell's outputs immediately.
- `clear_output(wait=True)`: defers the clear until the next output arrives, which then replaces the cell's outputs instead of appending - so progress bars and training loops render as a single in-place-updating output. A deferred clear also prevents a subsequent stream message from merging into the previous (about-to-be-cleared) stream output.

The clear_output event was already plumbed end to end (supervisor `RuntimeMessageEmitter` -> extension host -> `MainThreadLanguageRuntime` -> session); nothing consumed it for notebooks. This PR also fixes `TestLanguageRuntimeSession.receiveClearOutputMessage`, which built the message with the wrong message type (`Output` instead of `ClearOutput`), so it never reached the clear_output emitter.

### Release Notes

#### New Features

- N/A

#### Bug Fixes

- Fixed `clear_output(wait=True)` duplicating notebook cell outputs instead of replacing them (#10459)

### Validation Steps

@:notebooks @:positron-notebooks

Unit tests in `runtimeNotebookCellExecution.vitest.ts` cover: immediate clear, deferred clear for display_data/execute_result/stream/error outputs, wait=False canceling a pending deferred clear, multiple deferred clears collapsing into one replace, suppression of stream-output merging after a deferred clear, and ignoring clear_output messages from other executions.

Manual QA - run this in a Python notebook (either editor) and verify a single output line updates in place instead of stacking:

```python
import time
from IPython.display import clear_output, display

for epoch in range(5):
    time.sleep(1)
    clear_output(wait=True)
    display(f"Epoch {epoch+1}/5 - loss: {0.5 - 0.08 * epoch:.3f}")
```

Also verify `clear_output()` (wait=False) immediately clears the output mid-run:

```python
import time
from IPython.display import clear_output

print("you should not see this")
time.sleep(2)
clear_output()
print("only this line remains")
```
