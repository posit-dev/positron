# Positron Assistant Testing Workspace

A home for various scripts, file and configurations to test the behaviour and affordances of Positron Assistant.

In order to leverage the custom agents/prompts/instructions, this workspace must be opened directly, not just as part of the qa-example-content workspace.

## Key Files

### Test Scripts

- **`plot-hallucination.r`** - R script that generates a plot with a random number and colour. This is an effective test case for possible hallucination issues, since the script doesn't explicitly state the values used in the plot that could be read by the LLM from the console output. The LLM should be able to interpret the plot and provide accurate information about the random number and colour of the number.

### Custom agents/prompts/instructions

- **`.vscode/positron/`** - contains custom Assistant agents, chat modes, instructions, and prompts.
  - Note: chat modes are now replaced with custom agents but are retained here for backwards-compatibility testing purposes
- **`llms.txt`** and **`positron.md`** - root-level prompt/instruction files for Assistant.

Learn more about customizing Assistant at:
- [positron.posit.co/assistant-chat-instructions](https://positron.posit.co/assistant-chat-instructions.html)
- [positron.posit.co/assistant-chat-agents](https://positron.posit.co/assistant-chat-agents.html)
