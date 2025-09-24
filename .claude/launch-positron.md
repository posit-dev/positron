Use this guide to launch Positron and its dependent daemons from the development environment. The exact commands and scripts are provided below.

Here is the command to check daemon status:

<daemon_check_command>
ps aux | grep -E "npm.*watch-(client|extensions)d" | grep -v grep
</daemon_check_command>

Here are the commands to start daemons:

<daemon_commands>
npm run watch-clientd &
npm run watch-extensionsd &
</daemon_commands>

Here is the script to launch the main application:

<launch_script>
./scripts/code.sh &
</launch_script>

## Your Task

When a user asks you to "launch" or "start" the application, you must follow a precise 5-step protocol to ensure the application starts correctly without blocking the user's session.

**Critical Requirements:**
- You must actively verify that daemon compilation is complete before launching the application
- You must launch the application in the background using `run_in_background=true`
- You must respond immediately after launching without monitoring or verifying the launch
- You must not block the user's session at any point

## Step-by-Step Protocol

**Step 1: Check Daemon Status**
- Run the daemon check command to see which daemons are currently running
- Skip this step only if you've already confirmed all daemons are running in the current session

**Step 2: Start Missing Daemons (if needed)**
- If any daemons are not running, start them using the daemon commands
- Run these commands in the background

**Step 3: Verify Compilation is Complete**
- This is the most critical step - you MUST actively verify compilation has finished
- Use the BashOutput tool to check daemon output logs
- Look for specific completion indicators:
  - "Finished compilation"
  - "Watching for file changes"
  - "Found 0 errors"
  - CSS compilation completion messages
- Initial compilation typically takes 30-60 seconds but can take 2-3 minutes on slower systems
- Keep checking until you see clear evidence that compilation is finished
- Do NOT just wait 30 seconds and assume it's done

**Step 4: Launch the Application**
- Run the launch script with `run_in_background=true`
- This ensures the application starts without blocking your session

**Step 5: Respond Immediately**
- Give a brief confirmation message such as:
  - "[Application name] launched in background"
  - "[Application name] is starting"
  - "Done, [application name] is running"
- Do NOT wait to verify the launch was successful
- Do NOT monitor the application output
- Do NOT provide lengthy explanations
- Return control to the user immediately

## Planning Your Actions

Before executing any commands, plan your approach systematically in <step_planning> tags:
1. State which step of the 5-step protocol you're currently on
2. If checking daemon status: List each daemon that should be running and note whether you need to check their status
3. If starting daemons: Identify exactly which daemon commands you need to run and confirm you'll use background execution
4. If verifying compilation: Specify which log files or output you'll check and what completion indicators you're looking for
5. If launching: Confirm you have the exact launch script command and that you'll include `run_in_background=true`
6. For each command you plan to run, write out the complete command with all necessary parameters

It's OK for this section to be quite long - thorough planning will help ensure you follow the protocol precisely and avoid common mistakes.

## Common Mistakes to Avoid

- **Running wrong commands**: Always refer back to the specific commands provided for each step
- **Blocking after launch**: Never pause or wait after running the launch script
- **Skipping compilation verification**: Always actively check that compilation is complete
- **Unnecessary monitoring**: Don't automatically check if the process started successfully
- **Verbose responses**: Keep your final confirmation brief and simple

## Example Interaction

User: "launch positron"
Assistant: [Plans and executes the 5-step protocol]
Assistant: "Positron launched in background"
[Session continues normally]

When you receive a launch request, begin by planning your approach step-by-step.
