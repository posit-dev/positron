# Console Issues Analysis for Positron IDE

**Analysis Date:** 2026-02-04

**Dataset Summary:**
- Open Console Issues: 100
- Closed Console Issues: 100
- Total Analyzed: 200

---

# REPORT A — OPEN ISSUES ANALYSIS

## A1 — Issue Inventory (Open Issues)

### Summary Table

| # | Title | Classification | Severity | Themes | Environment |
|---|-------|----------------|----------|--------|-------------|
| [#11627](https://github.com/posit-dev/positron/issues/11627) | Text is added on the R console output | Bug | Medium | Startup reliability, Output correctness | Linux, R |
| [#11519](https://github.com/posit-dev/positron/issues/11519) | Plots are only rendered at the end of a loop | Enhancement | Medium | Output correctness, Resource visibility | Windows |
| [#11478](https://github.com/posit-dev/positron/issues/11478) | Console: Mechanism to select start folder in multi-root work... | Bug | Medium | Startup reliability, Session/runtime integration | R |
| [#11458](https://github.com/posit-dev/positron/issues/11458) | Console: Resource usage not visible when there is only one s... | Bug | Medium | Output correctness, Session/runtime integration | Not specified |
| [#11411](https://github.com/posit-dev/positron/issues/11411) | console: double-clicking text should select it, not jump to ... | Bug | Medium | Output correctness, Interaction behaviors | Not specified |
| [#11230](https://github.com/posit-dev/positron/issues/11230) | Startup of console hangs the first time starting positron af... | Bug | Medium | Startup reliability, Output correctness | Linux, R |
| [#11221](https://github.com/posit-dev/positron/issues/11221) | Windows conda consoles not working | Bug | Medium | Output correctness, Session/runtime integration | Windows, Python/R/Conda |
| [#11157](https://github.com/posit-dev/positron/issues/11157) | No completions in new, experimental notebook consoles | Enhancement | Medium | Focus + input targeting, Output correctness | Windows, Python |
| [#11142](https://github.com/posit-dev/positron/issues/11142) | Notebook consoles: Plots rendered as tiny, useless thumbnail... | Bug | High | Output correctness, Session/runtime integration | Not specified |
| [#11104](https://github.com/posit-dev/positron/issues/11104) | Inline display of plots in Console | Enhancement | Medium | Output correctness | Not specified |
| [#11031](https://github.com/posit-dev/positron/issues/11031) | Show indicator on Positron consoles that need to be restarte... | Bug | Medium | Startup reliability, Output correctness | Not specified |
| [#10972](https://github.com/posit-dev/positron/issues/10972) | LSP in the console: let language servers statically analyze ... | Bug | Medium | Focus + input targeting, Session/runtime integration | Python |
| [#10929](https://github.com/posit-dev/positron/issues/10929) | Console: Return of the Dancing Consoles (flipping between R/... | Bug | Medium | Focus + input targeting, Startup reliability | Python/R |
| [#10852](https://github.com/posit-dev/positron/issues/10852) | Improve treatment for xarray objects in Console and Variable... | Enhancement | Medium | Output correctness, Resource visibility | Python |
| [#10849](https://github.com/posit-dev/positron/issues/10849) | Provide customizable notification for long running execution... | Enhancement | Low | Other | R |
| [#10767](https://github.com/posit-dev/positron/issues/10767) | Session nicknames need a different treatment in, e.g., "exit... | Enhancement | Medium | Startup reliability, Session/runtime integration | R |
| [#10709](https://github.com/posit-dev/positron/issues/10709) | Epic: Notebook Console improvements and issues | Bug | Medium | Other | Not specified |
| [#10582](https://github.com/posit-dev/positron/issues/10582) | Console can get stuck "Starting..." forever if extension hos... | Bug | Low | Startup reliability, Output correctness | Not specified |
| [#10416](https://github.com/posit-dev/positron/issues/10416) | R Console Formatting of `message()` and `warning()` | Bug | Medium | Output correctness | R |
| [#10411](https://github.com/posit-dev/positron/issues/10411) | Console: Poor/no feedback when kernel is unreachable | Bug | Medium | Focus + input targeting, Startup reliability | Python |
| [#10204](https://github.com/posit-dev/positron/issues/10204) | Implement file paste and drop for the console | Bug | Medium | Startup reliability, Output correctness | Python/R |
| [#10016](https://github.com/posit-dev/positron/issues/10016) | Python console intermittently fails to restart properly (res... | Bug | Medium | Startup reliability, Output correctness | Linux, Python/R |
| [#9856](https://github.com/posit-dev/positron/issues/9856) | Columns with a URL that are abbreviated in the console chang... | Bug | Medium | Interaction behaviors, Performance | Not specified |
| [#9759](https://github.com/posit-dev/positron/issues/9759) | Notebooks: When a notebook console is active, autocompletion... | Bug | High | Output correctness, Session/runtime integration | R |
| [#9755](https://github.com/posit-dev/positron/issues/9755) | Queued code in one R session breaks LSP in other R session | Bug | High | Startup reliability, Output correctness | R |
| [#9699](https://github.com/posit-dev/positron/issues/9699) | Notebook: Notebook consoles don't show plots or HTML widgets | Bug | Medium | Output correctness, Session/runtime integration | R |
| [#9530](https://github.com/posit-dev/positron/issues/9530) | Output from later/promises doesn't get matched to correct co... | Bug | Medium | Focus + input targeting, Output correctness | Not specified |
| [#9500](https://github.com/posit-dev/positron/issues/9500) | "Ctrl+n" keybinding does not work in the R console | Bug | High | Focus + input targeting, Output correctness | R |
| [#9486](https://github.com/posit-dev/positron/issues/9486) | cat(msg) appends a newline even if 'msg' doesn't have one | Bug | Medium | Session/runtime integration | Linux, R |
| [#9449](https://github.com/posit-dev/positron/issues/9449) | Slow startup (time to interactive R console) | Bug | Medium | Startup reliability, Output correctness | Windows, Python/R |
| [#9208](https://github.com/posit-dev/positron/issues/9208) | Positron can't render progress bar powered by `ipywidgets` | Bug | Medium | Startup reliability, Output correctness | Linux, Python |
| [#9123](https://github.com/posit-dev/positron/issues/9123) | Console: Variables within contributed environment variables ... | Bug | Medium | Session/runtime integration, Resource visibility | Not specified |
| [#8915](https://github.com/posit-dev/positron/issues/8915) | Console: Reduce code execution latency by reducing roundtrip... | Bug | Medium | Startup reliability, Output correctness | Python |
| [#8912](https://github.com/posit-dev/positron/issues/8912) | Console: Option to hide sidebar/console tab list | Bug | Medium | Session/runtime integration, Resource visibility | Python/R |
| [#8803](https://github.com/posit-dev/positron/issues/8803) | Should `"editor.acceptSuggestionOnEnter": "smart"` apply to ... | Enhancement | Medium | Focus + input targeting, Startup reliability | Not specified |
| [#8738](https://github.com/posit-dev/positron/issues/8738) | Cannot scroll within multiline statements in R Console | Enhancement | High | Focus + input targeting, Startup reliability | Windows, R |
| [#8690](https://github.com/posit-dev/positron/issues/8690) | Cannot clear line when in pdb | Bug | High | Session/runtime integration, Interaction behaviors | R |
| [#8687](https://github.com/posit-dev/positron/issues/8687) | Console input prompt does not focus when an activity input p... | Bug | Medium | Focus + input targeting, Output correctness | Python/R |
| [#8682](https://github.com/posit-dev/positron/issues/8682) | Sometimes complex values don't print in the R Console the fi... | Bug | Medium | Startup reliability, Output correctness | Windows, R |
| [#8597](https://github.com/posit-dev/positron/issues/8597) | Assistant: Console Quick Fix on Traceback Hover | Enhancement | Medium | Output correctness, Session/runtime integration | Python/R |
| [#8471](https://github.com/posit-dev/positron/issues/8471) | Console: Pasting can jitter the console preventing it from a... | Bug | Medium | Output correctness, Interaction behaviors | R |
| [#8450](https://github.com/posit-dev/positron/issues/8450) | Respect `options(shiny.launch.browser = TRUE)` when running ... | Enhancement | Medium | Startup reliability, Output correctness | R |
| [#8447](https://github.com/posit-dev/positron/issues/8447) | Un-register interpreter when a runtime is removed by user | Bug | High | Startup reliability, Output correctness | R |
| [#8333](https://github.com/posit-dev/positron/issues/8333) | Python console often gets stuck in Restarting state | Bug | Medium | Startup reliability, Session/runtime integration | Python |
| [#8282](https://github.com/posit-dev/positron/issues/8282) | Console duplicates executions and lacks busy indicator durin... | Bug | Low | Output correctness, Session/runtime integration | Python |
| [#8201](https://github.com/posit-dev/positron/issues/8201) | Can't correctly paste into Python `input()` or R `menu()` pr... | Bug | Medium | Focus + input targeting, Output correctness | Windows, Python |
| [#8173](https://github.com/posit-dev/positron/issues/8173) | Cmd + click on link in Console asks about an external URI op... | Bug | Medium | Output correctness, Session/runtime integration | Not specified |
| [#8145](https://github.com/posit-dev/positron/issues/8145) | Console: "Extensions restarting..." flashes when closing, sw... | Bug | Critical | Startup reliability, Session/runtime integration | macOS, Python/R |
| [#8047](https://github.com/posit-dev/positron/issues/8047) | Split or fork an existing console | Bug | Medium | Session/runtime integration, Interaction behaviors | Not specified |
| [#8000](https://github.com/posit-dev/positron/issues/8000) | R console failing to start | Bug | Medium | Startup reliability, Output correctness | Windows, R |

*Note: Showing first 50 of 100 issues. See full analysis for complete list.*

### Detailed Issue Breakdown

#### Issue #11627: Text is added on the R console output

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Interaction behaviors, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/11627

**Environment:**
- OS: Linux
- Runtime: R

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #11519: Plots are only rendered at the end of a loop

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Output correctness, Resource visibility
**URL:** https://github.com/posit-dev/positron/issues/11519

**Environment:**
- OS: Windows

**Primary Symptom:**
Type: <b>Bug</b> I am performing an image reconstruction from noisy data and I am testing the reconstruction over several different regularization parameters. This means that I have a loop of this for...

---

#### Issue #11478: Console: Mechanism to select start folder in multi-root workspace

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Session/runtime integration, Interaction behaviors, Workspace context, Performance
**URL:** https://github.com/posit-dev/positron/issues/11478

**Environment:**
- Runtime: R

**Primary Symptom:**
## System details: #### Positron and OS details: ```...

---

#### Issue #11458: Console: Resource usage not visible when there is only one session

**Classification:** Bug
**Severity:** Medium
**Themes:** Output correctness, Session/runtime integration, Resource visibility
**URL:** https://github.com/posit-dev/positron/issues/11458

**Environment:**
- Not specified in issue text

**Primary Symptom:**
## System details: #### Positron and OS details: ```...

---

#### Issue #11411: console: double-clicking text should select it, not jump to the bottom

**Classification:** Bug
**Severity:** Medium
**Themes:** Output correctness, Interaction behaviors
**URL:** https://github.com/posit-dev/positron/issues/11411

**Environment:**
- Not specified in issue text

**Primary Symptom:**
>Any time I click something in the Positron console, it automatically scrolls to the bottom (see video). How can I turn off this setting? https://github.com/user-attachments/assets/d748a46e-1373-47a6-...

---

#### Issue #11230: Startup of console hangs the first time starting positron after upgrade

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Workspace context, Performance
**URL:** https://github.com/posit-dev/positron/issues/11230

**Environment:**
- OS: Linux
- Runtime: R

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #11221: Windows conda consoles not working

**Classification:** Bug
**Severity:** Medium
**Themes:** Output correctness, Session/runtime integration, Resource visibility, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/11221

**Environment:**
- OS: Windows
- Runtime: Python, R, Conda

**Primary Symptom:**
## System details: #### Positron and OS details: Positron Version: 2025.12.2 (system setup) build 5...

---

#### Issue #11157: No completions in new, experimental notebook consoles

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Focus + input targeting, Output correctness, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/11157

**Environment:**
- OS: Windows
- Runtime: Python
- Deployment: Workbench

**Primary Symptom:**
## System details: #### Positron and OS details: Positron Version: 2025.10.1 build 4...

---

#### Issue #11142: Notebook consoles: Plots rendered as tiny, useless thumbnails with broken inspector

**Classification:** Bug
**Severity:** High
**Themes:** Output correctness, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/11142

**Environment:**
- Not specified in issue text

**Primary Symptom:**
## System details: #### Positron and OS details: ```...

---

#### Issue #11104: Inline display of plots in Console

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Output correctness
**URL:** https://github.com/posit-dev/positron/issues/11104

**Environment:**
- Not specified in issue text

**Primary Symptom:**
We could make it possible to see plot output in the Console, in addition to (or perhaps instead of) the Plots pane. The Console already has some support for this, in fact; if you use a notebook consol...

---

#### Issue #11031: Show indicator on Positron consoles that need to be restarted to apply changes

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Resource visibility, Performance
**URL:** https://github.com/posit-dev/positron/issues/11031

**Environment:**
- Not specified in issue text

**Primary Symptom:**
## System details: #### Positron and OS details: ```...

---

#### Issue #10972: LSP in the console: let language servers statically analyze console history

**Classification:** Bug
**Severity:** Medium
**Themes:** Focus + input targeting, Session/runtime integration, Interaction behaviors, Resource visibility
**URL:** https://github.com/posit-dev/positron/issues/10972

**Environment:**
- Runtime: Python
- Deployment: Server

**Primary Symptom:**
Today, language servers in the Console only have access to the current input line(s), not history. This means that static analysis isn't sufficient to determine details about all code in Positron. We ...

---

#### Issue #10929: Console: Return of the Dancing Consoles (flipping between R/Python at boot)

**Classification:** Bug
**Severity:** Medium
**Themes:** Focus + input targeting, Startup reliability, Session/runtime integration, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/10929

**Environment:**
- Runtime: Python, R

**Primary Symptom:**
## System details: #### Positron and OS details: ```...

---

#### Issue #10852: Improve treatment for xarray objects in Console and Variables pane

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Output correctness, Resource visibility, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/10852

**Environment:**
- Runtime: Python

**Primary Symptom:**
Currently if you execute: ```python cube_to_upscale = xr.open_dataset("data/your_zarr_file.zarr")...

---

#### Issue #10849: Provide customizable notification for long running execution in the console

**Classification:** Enhancement
**Severity:** Low
**Themes:** Other
**URL:** https://github.com/posit-dev/positron/issues/10849

**Environment:**
- Runtime: R

**Primary Symptom:**
Sometimes I have some long running executions in the console and it would be interesting to configure some kind of hook or event that can customize to run some code such as a small notification sound ...

---

#### Issue #10767: Session nicknames need a different treatment in, e.g., "exited" or "restarted" console messages

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Startup reliability, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/10767

**Environment:**
- Runtime: R

**Primary Symptom:**
I had good reason to use multiple R sessions today and to give them nicknames. (I was comparing behaviour of an R package in a PR branch vs. `main`.) Multi-sessions and the nicknames was very useful! ...

---

#### Issue #10709: Epic: Notebook Console improvements and issues

**Classification:** Bug
**Severity:** Medium
**Themes:** Other
**URL:** https://github.com/posit-dev/positron/issues/10709

**Environment:**
- Not specified in issue text

**Primary Symptom:**
Epic for Notebook console related issues in Positron notebook...

---

#### Issue #10582: Console can get stuck "Starting..." forever if extension host does not start

**Classification:** Bug
**Severity:** Low
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Performance
**URL:** https://github.com/posit-dev/positron/issues/10582

**Environment:**
- Deployment: Workbench
- Not specified in issue text

**Primary Symptom:**
We don't have a repro for this, but we've seen a number of cases in the wild (on both Desktop and Workbench) wherein the extension host fails to start. When this happens, the Console just says "Starti...

---

#### Issue #10416: R Console Formatting of `message()` and `warning()`

**Classification:** Bug
**Severity:** Medium
**Themes:** Output correctness
**URL:** https://github.com/posit-dev/positron/issues/10416

**Environment:**
- Runtime: R

**Primary Symptom:**
### Discussed in https://github.com/posit-dev/positron/discussions/10362 <div type='discussions-op-text'> <sup>Originally posted by **dertristan** November  4, 2025</sup>...

---

#### Issue #10411: Console: Poor/no feedback when kernel is unreachable

**Classification:** Bug
**Severity:** Medium
**Themes:** Focus + input targeting, Startup reliability, Output correctness, Session/runtime integration, Interaction behaviors, Performance
**URL:** https://github.com/posit-dev/positron/issues/10411

**Environment:**
- Runtime: Python

**Primary Symptom:**
## System details: #### Positron and OS details: ```...

---

#### Issue #10204: Implement file paste and drop for the console

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Interaction behaviors, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/10204

**Environment:**
- Runtime: Python, R
- Deployment: Workbench

**Primary Symptom:**
Extend the file path paste/drop feature (currently working in R and Python scripts) to also work in the R and Python consoles. ## Background As of #9886, users can paste or drop files from their file ...

---

#### Issue #10016: Python console intermittently fails to restart properly (restart button on console action bar)

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Interaction behaviors, Resource visibility, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/10016

**Environment:**
- OS: Linux
- Runtime: Python, R
- Deployment: Server

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #9856: Columns with a URL that are abbreviated in the console change the actual content of that column (when clicking).

**Classification:** Bug
**Severity:** Medium
**Themes:** Interaction behaviors, Performance
**URL:** https://github.com/posit-dev/positron/issues/9856

**Environment:**
- Not specified in issue text

**Primary Symptom:**
I have noticed that when URLs are abbreviated in the console with '...', the actual content in the column is also abbreviated. Try clicking the link in the url column to before and after selecting and...

---

#### Issue #9759: Notebooks: When a notebook console is active, autocompletion does not work in scripts

**Classification:** Bug
**Severity:** High
**Themes:** Output correctness, Session/runtime integration, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/9759

**Environment:**
- Runtime: R

**Primary Symptom:**
## System details: #### Positron and OS details: ```...

---

#### Issue #9755: Queued code in one R session breaks LSP in other R session

**Classification:** Bug
**Severity:** High
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/9755

**Environment:**
- Runtime: R

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #9699: Notebook: Notebook consoles don't show plots or HTML widgets

**Classification:** Bug
**Severity:** Medium
**Themes:** Output correctness, Session/runtime integration, Interaction behaviors, Resource visibility
**URL:** https://github.com/posit-dev/positron/issues/9699

**Environment:**
- Runtime: R

**Primary Symptom:**
## System details: #### Positron and OS details: ```...

---

#### Issue #9530: Output from later/promises doesn't get matched to correct console input

**Classification:** Bug
**Severity:** Medium
**Themes:** Focus + input targeting, Output correctness
**URL:** https://github.com/posit-dev/positron/issues/9530

**Environment:**
- Not specified in issue text

**Primary Symptom:**
I haven't investigated yet, but it's pretty weird: ```r async_method <- coro::async(function() {...

---

#### Issue #9500: "Ctrl+n" keybinding does not work in the R console

**Classification:** Bug
**Severity:** High
**Themes:** Focus + input targeting, Output correctness, Session/runtime integration, Interaction behaviors
**URL:** https://github.com/posit-dev/positron/issues/9500

**Environment:**
- Runtime: R

**Primary Symptom:**
## System details: #### Positron and OS details: Positron Version: 2025.08.0 build 130...

---

#### Issue #9486: cat(msg) appends a newline even if 'msg' doesn't have one

**Classification:** Bug
**Severity:** Medium
**Themes:** Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/9486

**Environment:**
- OS: Linux
- Runtime: R

**Primary Symptom:**
1 - The following works as expected in Positron, RStudio, and terminal R: ```r > cat("a\n")...

---

#### Issue #9449: Slow startup (time to interactive R console)

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Interaction behaviors, Workspace context, Performance
**URL:** https://github.com/posit-dev/positron/issues/9449

**Environment:**
- OS: Windows
- Runtime: Python, R

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #9208: Positron can't render progress bar powered by `ipywidgets`

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/9208

**Environment:**
- OS: Linux
- Runtime: Python

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #9123: Console: Variables within contributed environment variables do not resolve 

**Classification:** Bug
**Severity:** Medium
**Themes:** Session/runtime integration, Resource visibility
**URL:** https://github.com/posit-dev/positron/issues/9123

**Environment:**
- Not specified in issue text

**Primary Symptom:**
Variables defined in Positron Environment may reference other variables: <img width="818" height="220" alt="Image" src="https://github.com/user-attachments/assets/7e4f6339-4b6b-4b51-aca7-b986d38d515c"...

---

#### Issue #8915: Console: Reduce code execution latency by reducing roundtrips

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Performance
**URL:** https://github.com/posit-dev/positron/issues/8915

**Environment:**
- Runtime: Python
- Deployment: Workbench

**Primary Symptom:**
Positron's Console can be sluggish to execute code compared to tools like RStudio. This is in part due to the fact that there are just more layers involved, but the biggest contributor is that every c...

---

#### Issue #8912: Console: Option to hide sidebar/console tab list

**Classification:** Bug
**Severity:** Medium
**Themes:** Session/runtime integration, Resource visibility
**URL:** https://github.com/posit-dev/positron/issues/8912

**Environment:**
- Runtime: Python, R

**Primary Symptom:**
Currently, if you have more than one session in Positron, you give up quite a lot of real estate in the IDE to the console tab list that is not reclaimable. For example, having one R and one Python se...

---

#### Issue #8803: Should `"editor.acceptSuggestionOnEnter": "smart"` apply to our console?

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Focus + input targeting, Startup reliability, Output correctness, Session/runtime integration, Interaction behaviors, Resource visibility, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/8803

**Environment:**
- Not specified in issue text

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #8738: Cannot scroll within multiline statements in R Console

**Classification:** Enhancement
**Severity:** High
**Themes:** Focus + input targeting, Startup reliability, Output correctness, Session/runtime integration, Interaction behaviors
**URL:** https://github.com/posit-dev/positron/issues/8738

**Environment:**
- OS: Windows
- Runtime: R

**Primary Symptom:**
## System details: #### Positron and OS details: Positron Version: 2025.08.0 (system setup) build 108...

---

#### Issue #8690: Cannot clear line when in pdb

**Classification:** Bug
**Severity:** High
**Themes:** Session/runtime integration, Interaction behaviors
**URL:** https://github.com/posit-dev/positron/issues/8690

**Environment:**
- Runtime: R

**Primary Symptom:**
## System details: #### Positron and OS details: Positron Version: 2025.07.0 build 204...

---

#### Issue #8687: Console input prompt does not focus when an activity input prompt ends

**Classification:** Bug
**Severity:** Medium
**Themes:** Focus + input targeting, Output correctness, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/8687

**Environment:**
- Runtime: Python, R

**Primary Symptom:**
## System details: #### Positron and OS details: Positron Version: 2025.07.0 build 999...

---

#### Issue #8682: Sometimes complex values don't print in the R Console the first time

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/8682

**Environment:**
- OS: Windows
- Runtime: R

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #8597: Assistant: Console Quick Fix on Traceback Hover

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Output correctness, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/8597

**Environment:**
- Runtime: Python, R

**Primary Symptom:**
Presently, Console tracebacks in Python highlight the error code in a yellow background. To mirror Editor behavior, Console should allow users to hover over the erroring code to receive an affordance ...

---

#### Issue #8471: Console: Pasting can jitter the console preventing it from auto scrolling

**Classification:** Bug
**Severity:** Medium
**Themes:** Output correctness, Interaction behaviors
**URL:** https://github.com/posit-dev/positron/issues/8471

**Environment:**
- Runtime: R

**Primary Symptom:**
I've seen this a number of times but haven't been able to narrow it down until now. - Have a full page of output in your Console, your prompt should be at the very bottom - Type `usethis:::`...

---

#### Issue #8450: Respect `options(shiny.launch.browser = TRUE)` when running R Shiny apps in the Console

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Resource visibility, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/8450

**Environment:**
- Runtime: R

**Primary Symptom:**
> [!TIP] > ### Workaround to open Shiny apps in default browser by default >...

---

#### Issue #8447: Un-register interpreter when a runtime is removed by user

**Classification:** Bug
**Severity:** High
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Interaction behaviors
**URL:** https://github.com/posit-dev/positron/issues/8447

**Environment:**
- Runtime: R
- Deployment: Workbench

**Primary Symptom:**
## System details: #### Positron and OS details: Positron Version: 2025.07.0 build 204...

---

#### Issue #8333: Python console often gets stuck in Restarting state

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/8333

**Environment:**
- Runtime: Python

**Primary Symptom:**
## System details: #### Positron and OS details: #### Interpreter details:...

---

#### Issue #8282: Console duplicates executions and lacks busy indicator during background tasks

**Classification:** Bug
**Severity:** Low
**Themes:** Output correctness, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/8282

**Environment:**
- Runtime: Python

**Primary Symptom:**
## System details: #### Positron and OS details: Positron Version: 2025.07.0 build 170...

---

#### Issue #8201: Can't correctly paste into Python `input()` or R `menu()` prompt in the console on Windows

**Classification:** Bug
**Severity:** Medium
**Themes:** Focus + input targeting, Output correctness, Session/runtime integration, Interaction behaviors
**URL:** https://github.com/posit-dev/positron/issues/8201

**Environment:**
- OS: Windows
- Runtime: Python

**Primary Symptom:**
#### Positron and OS details: Positron Version: 2025.07.0 (system setup) build 112 Code - OSS Version: 1.100.0...

---

#### Issue #8173: Cmd + click on link in Console asks about an external URI opener

**Classification:** Bug
**Severity:** Medium
**Themes:** Output correctness, Session/runtime integration, Interaction behaviors, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/8173

**Environment:**
- Not specified in issue text

**Primary Symptom:**
## System details: #### Positron and OS details: Positron Version: 2025.07.0 (Universal) build 134...

---

#### Issue #8145: Console: "Extensions restarting..." flashes when closing, switching workspaces, etc.

**Classification:** Bug
**Severity:** Critical
**Themes:** Startup reliability, Session/runtime integration, Workspace context, Performance
**URL:** https://github.com/posit-dev/positron/issues/8145

**Environment:**
- OS: macOS
- Runtime: Python, R

**Primary Symptom:**
## System details: #### Positron and OS details: ```...

---

#### Issue #8047: Split or fork an existing console

**Classification:** Bug
**Severity:** Medium
**Themes:** Session/runtime integration, Interaction behaviors
**URL:** https://github.com/posit-dev/positron/issues/8047

**Environment:**
- Not specified in issue text

**Primary Symptom:**
## Feature Request Sometimes users want to split an existing console's state into a new "copy" or fork of that console. This would allow users to diverge in their exploration, testing or other work. >...

---

#### Issue #8000: R console failing to start

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Resource visibility
**URL:** https://github.com/posit-dev/positron/issues/8000

**Environment:**
- OS: Windows
- Runtime: R
- Deployment: Server

**Primary Symptom:**
Type: <b>Bug</b> Fresh install of Positron, default configuration, no extensions added after clean install. No previously installed Positron on this system. OS - Windows 11, all updates installed. R v...

---

#### Issue #7903: Absent action/behavior for 'Show Active Interpreter Session Profile Report' (workbench.action.languageRuntime.showProfile)

**Classification:** Bug
**Severity:** Medium
**Themes:** Output correctness, Session/runtime integration, Interaction behaviors, Workspace context, Performance
**URL:** https://github.com/posit-dev/positron/issues/7903

**Environment:**
- OS: macOS
- Runtime: Python, R
- Deployment: Workbench

**Primary Symptom:**
## System details: macOS Sequoia 15.5.0 #### Positron and OS details: Positron Version: 2025.07.0 (Universal) build 1...

---

#### Issue #7713: Re-Run Previous Region

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Interaction behaviors
**URL:** https://github.com/posit-dev/positron/issues/7713

**Environment:**
- Not specified in issue text

**Primary Symptom:**
One thing I used in RStudio a lot was [`Re-Run Previous Region`](https://docs.posit.co/ide/user/ide/guide/code/execution.html#executing-multiple-lines) aka `Re-run Previous Code Execution`. Reminder t...

---

#### Issue #7575: Epic: Assistant: Support Inline Chat for Console

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Focus + input targeting
**URL:** https://github.com/posit-dev/positron/issues/7575

**Environment:**
- Runtime: R

**Primary Symptom:**
In the Editor, Noteboks, and the Terminal (https://github.com/posit-dev/positron/issues/7573), you can press <kbd>Cmd</kbd> <kbd>I</kbd> to invoke an Inline Chat widget that asks Assistant to generate...

---

#### Issue #7517: Progress from progressr R package prints too many newlines

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Interaction behaviors, Workspace context, Performance
**URL:** https://github.com/posit-dev/positron/issues/7517

**Environment:**
- Runtime: Python, R

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #7425: How to set max print lines in Positron when using Python

**Classification:** Enhancement
**Severity:** High
**Themes:** Output correctness, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/7425

**Environment:**
- OS: Windows
- Runtime: Python

**Primary Symptom:**
## System details: #### Positron and OS details: Positron Version: 2025.05.0 (system setup) build 103...

---

#### Issue #7379: Console: Can't navigate history popup with PageUp/PageDown or click

**Classification:** Bug
**Severity:** Medium
**Themes:** Session/runtime integration, Interaction behaviors
**URL:** https://github.com/posit-dev/positron/issues/7379

**Environment:**
- Runtime: Python, R

**Primary Symptom:**
## System details: #### Positron and OS details: ```...

---

#### Issue #7296: Cannot use ctrl+enter to excute code in some situations

**Classification:** Bug
**Severity:** Critical
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/7296

**Environment:**
- OS: Windows

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #7236: Output from stdout and stderr disappears when running `later` callback

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/7236

**Environment:**
- Not specified in issue text

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #7138: Positron's Python (seems) do not respect Conda environment variables when calling other CLI tools using Python

**Classification:** Enhancement
**Severity:** High
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Interaction behaviors, Resource visibility, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/7138

**Environment:**
- Runtime: Python, Conda
- Deployment: Workbench

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #7118: Console: Unable to focus after Notebook + Max Aux Bar View

**Classification:** Bug
**Severity:** Medium
**Themes:** Focus + input targeting, Output correctness, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/7118

**Environment:**
- Not specified in issue text

**Primary Symptom:**
## System details: #### Positron and OS details: [2025.05.0-6](https://github.com/posit-dev/positron-builds/releases/tag/2025.05.0-6)...

---

#### Issue #7100: Python: Cursor skips to end of function after an empty line

**Classification:** Bug
**Severity:** Medium
**Themes:** Focus + input targeting, Output correctness, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/7100

**Environment:**
- OS: Linux
- Runtime: Python

**Primary Symptom:**
## System details: #### Positron and OS details: Positron Version: 2025.03.0 build 116...

---

#### Issue #7072: Session quickpick should order items by the last selected time

**Classification:** Bug
**Severity:** Medium
**Themes:** Session/runtime integration, Interaction behaviors, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/7072

**Environment:**
- Not specified in issue text

**Primary Symptom:**
Several mechanisms in the multisession environment sort sessions & runtimes based on the `ILanguageRuntimeSession.lastUsed` attribute. Currently, the semantics of this is the last time code was execut...

---

#### Issue #6986: multi-console: reconsider approach to console history (separate histories per session)

**Classification:** Bug
**Severity:** Medium
**Themes:** Output correctness, Session/runtime integration, Interaction behaviors, Resource visibility
**URL:** https://github.com/posit-dev/positron/issues/6986

**Environment:**
- Runtime: Python, R

**Primary Symptom:**
## System details: #### Positron and OS details: Seeing it on...

---

#### Issue #6976: tools:::CRAN_check_details() crashes positron

**Classification:** Bug
**Severity:** Critical
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/6976

**Environment:**
- Not specified in issue text

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #6940: Add a setting that controls whether "Open in editor" in the Console turns output into comments.

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Output correctness, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/6940

**Environment:**
- Runtime: Python, R

**Primary Symptom:**
## System details: #### Positron and OS details: Positron after #6912 is merged....

---

#### Issue #6896: Console Restore: Possibility for dropped output

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/6896

**Environment:**
- Not specified in issue text

**Primary Symptom:**
## System details: #### Positron and OS details: ```...

---

#### Issue #6895: Console Restore: Continuation prompts not restored

**Classification:** Bug
**Severity:** Medium
**Themes:** Focus + input targeting, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/6895

**Environment:**
- Runtime: Python, R

**Primary Symptom:**
## System details: #### Positron and OS details: ```...

---

#### Issue #6843: UI: React components miss state updates between construction and render

**Classification:** Bug
**Severity:** Medium
**Themes:** Output correctness, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/6843

**Environment:**
- Not specified in issue text

**Primary Symptom:**
After opening multiple consoles, reloading Positron does not restore consoles. The sessions are active, seen in the Session Switcher quickpick and Runtimes pane. <img width="1840" alt="Image" src="htt...

---

#### Issue #6839: Console Multisessions: Autocomplete is not consistent/complete

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/6839

**Environment:**
- Runtime: Python, R

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #6826: Session Quick Pick Missing Entries

**Classification:** Bug
**Severity:** Medium
**Themes:** Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/6826

**Environment:**
- Not specified in issue text

**Primary Symptom:**
Session quick is missing entries when running Playwright. Possibly an upstream issue? Unsure if ever appears when not in an e2e environment. Encountered with @midleman. ![Image](https://github.com/use...

---

#### Issue #6812: Consider removing debounce on `notifyForegroundSessionChanged` in favor of extension side handling

**Classification:** Bug
**Severity:** Medium
**Themes:** Output correctness, Session/runtime integration, Performance
**URL:** https://github.com/posit-dev/positron/issues/6812

**Environment:**
- Not specified in issue text

**Primary Symptom:**
_Originally posted by @jmcphers in https://github.com/posit-dev/positron/pull/6714#pullrequestreview-2691041469_: We can revisit this, but I think that ultimately the debounce should be done on the ex...

---

#### Issue #6801: Python multiprocessing only works in "fork"

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/6801

**Environment:**
- Runtime: Python, R, Conda

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #6720: Multisession console: add support to programmatically launch new console sessions

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Startup reliability, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/6720

**Environment:**
- Runtime: R
- Deployment: Workbench

**Primary Symptom:**
_Originally posted by @Aariq in https://github.com/posit-dev/positron/discussions/6712#discussioncomment-12452664_: > Is there a way currently (or plans to have a way) to launch new consoles programma...

---

#### Issue #6120: name '__file__' is not defined when using os/sys

**Classification:** Bug
**Severity:** Medium
**Themes:** Workspace context
**URL:** https://github.com/posit-dev/positron/issues/6120

**Environment:**
- Runtime: Python

**Primary Symptom:**
The following works fine on a clean VSCode : ``` import os...

---

#### Issue #6054: Unreliable display of `xarray` Dataset metadata

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Resource visibility, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/6054

**Environment:**
- OS: macOS
- Runtime: Python

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #6048: Provide a keybinding for navigating inside the Panel (esp to/from the Console)

**Classification:** Bug
**Severity:** Medium
**Themes:** Focus + input targeting
**URL:** https://github.com/posit-dev/positron/issues/6048

**Environment:**
- Not specified in issue text

**Primary Symptom:**
There are a couple of commands that make it easy to navigate inside the Panel, _Previous/Next Panel View_: <img width="619" alt="Image" src="https://github.com/user-attachments/assets/e1712d85-6845-4a...

---

#### Issue #5898: Console: should Esc cancel a continuation prompt?

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Interaction behaviors, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/5898

**Environment:**
- Runtime: Python, R

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #5840: Python: Improve the discovery of the %view magic use in the Console to view Data Frames

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Interaction behaviors, Resource visibility
**URL:** https://github.com/posit-dev/positron/issues/5840

**Environment:**
- Runtime: Python, R

**Primary Symptom:**
## Describe the issue: Positron extended the % magics from ipython, including a `%view` magic syntax that allows the user to launch a "Data Explorer" view for a Data Frame variable from a Python Conso...

---

#### Issue #5797: Create new command to interpolate text into code, to run in the console

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Focus + input targeting, Interaction behaviors
**URL:** https://github.com/posit-dev/positron/issues/5797

**Environment:**
- Deployment: Workbench
- Not specified in issue text

**Primary Symptom:**
In https://github.com/posit-dev/positron/discussions/5747 we've got a feature request for a command similar to `workbench.action.executeCode.console` that would allow someone to interpolate a selectio...

---

#### Issue #5710: Windows: `Ctrl + C` is unreliable to interrupt a `readline()`

**Classification:** Bug
**Severity:** Medium
**Themes:** Focus + input targeting, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/5710

**Environment:**
- Runtime: R

**Primary Symptom:**
`Ctrl + C` works _sometimes_ to get you out of readline, but not reliably https://github.com/user-attachments/assets/9d5e74de-b970-4229-9ff7-bfd892ced9fd ## When it works...

---

#### Issue #5674: Console UI could be extended to allow rich information to be shown when a runtime has not yet started.

**Classification:** Enhancement
**Severity:** High
**Themes:** Startup reliability, Output correctness, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/5674

**Environment:**
- Not specified in issue text

**Primary Symptom:**
There are multiple scenarios where a valid runtime cannot be started for a session, and the Console is essentially dead in this state. We do have some basic initial state that prompts people to start ...

---

#### Issue #5581: Console: Sticky Scroll; show command for context while viewing its output

**Classification:** Bug
**Severity:** Medium
**Themes:** Output correctness, Interaction behaviors
**URL:** https://github.com/posit-dev/positron/issues/5581

**Environment:**
- Runtime: R

**Primary Symptom:**
VS Code's Editor and Terminal panes support a Sticky Scroll feature that locks relevant context lines to the top and/or bottom of the pane. https://learn.microsoft.com/en-us/visualstudio/ide/editor-st...

---

#### Issue #5526: Prefer displaying the console when switching tabs on the panel

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Interaction behaviors, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/5526

**Environment:**
- OS: macOS
- Runtime: Python, R

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #5462: Persisting UI state on session reload

**Classification:** Bug
**Severity:** Medium
**Themes:** Output correctness, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/5462

**Environment:**
- Deployment: Workbench
- Not specified in issue text

**Primary Symptom:**
This is a collection of sub-issues relating to persisting state when Positron is reloaded, whether in a Desktop build, Web build or Workbench build. ### What "reloaded" means in the different builds: ...

---

#### Issue #5452: Should execution mode be handled by the main thread rather than runtimes?

**Classification:** Bug
**Severity:** Medium
**Themes:** Focus + input targeting, Output correctness, Session/runtime integration, Interaction behaviors, Performance
**URL:** https://github.com/posit-dev/positron/issues/5452

**Environment:**
- Runtime: Python

**Primary Symptom:**
One thing that confused me while reviewing https://github.com/posit-dev/positron/pull/5450 is how the Transient execution mode worked with existing code calling the `execute()` method of language runt...

---

#### Issue #5434: R: list of preloaded data is displayed outside Positron using `data()`

**Classification:** Bug
**Severity:** Medium
**Themes:** Output correctness, Session/runtime integration
**URL:** https://github.com/posit-dev/positron/issues/5434

**Environment:**
- OS: Windows
- Runtime: R

**Primary Symptom:**
## System details: Windows 11 #### Positron and OS details:...

---

#### Issue #5272: Frontend should break up multiline selections that get sent to Console by complete expressions

**Classification:** Bug
**Severity:** High
**Themes:** Focus + input targeting, Startup reliability, Output correctness, Session/runtime integration, Interaction behaviors, Workspace context, Performance
**URL:** https://github.com/posit-dev/positron/issues/5272

**Environment:**
- Runtime: Python

**Primary Symptom:**
(Extracted from #1326 where we discussed breaking up selections both by expressions on the frontend side and by new lines on the backend side. We implemented the latter approach in https://github.com/...

---

#### Issue #5189: Unexpected continuation prompt on Enter due to conflict between completions and console

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Focus + input targeting, Startup reliability, Output correctness, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/5189

**Environment:**
- Runtime: R
- Deployment: Workbench

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://positron.posit.co/feedback.html...

---

#### Issue #5115: Feature request: add more JSON prompts in the workbench settings to allow distinguishing of sent and received code and output

**Classification:** Enhancement
**Severity:** Low
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Interaction behaviors, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/5115

**Environment:**
- Runtime: R

**Primary Symptom:**
as discussed in: #5069 Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues:...

---

#### Issue #5023: `executeCode`: Surprising behaviour when evaluating syntactically incorrect code

**Classification:** Bug
**Severity:** Medium
**Themes:** Session/runtime integration, Interaction behaviors
**URL:** https://github.com/posit-dev/positron/issues/5023

**Environment:**
- Runtime: R

**Primary Symptom:**
Take this long function which has a syntax error: ```r f <- function() {...

---

#### Issue #4850: Cannot run code in Working Tree

**Classification:** Enhancement
**Severity:** High
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Interaction behaviors, Workspace context, Performance
**URL:** https://github.com/posit-dev/positron/issues/4850

**Environment:**
- Runtime: Python, R

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://github.com/posit-dev/positron/wiki/Feedback-and-Issues...

---

#### Issue #4802: Statement range executions currently aren't considered as `input_reply`s, is that right?

**Classification:** Bug
**Severity:** Medium
**Themes:** Focus + input targeting
**URL:** https://github.com/posit-dev/positron/issues/4802

**Environment:**
- Not specified in issue text

**Primary Symptom:**
Check out this RStudio behavior where if we send input to the console from an editor with `Cmd + Enter`, then that input is used when we are in a `readline()` prompt: https://github.com/user-attachmen...

---

#### Issue #4594: Invalid input run from editor does not produce error in console (is not executed)

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Focus + input targeting, Startup reliability, Output correctness, Session/runtime integration, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/4594

**Environment:**
- OS: Windows

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://github.com/posit-dev/positron/wiki/Feedback-and-Issues...

---

#### Issue #4585: Console: Pasting a very long chunk of code into the console breaks scroll

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Interaction behaviors, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/4585

**Environment:**
- Runtime: Python, R

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://github.com/posit-dev/positron/wiki/Feedback-and-Issues...

---

#### Issue #4580: Reticulate Python output not shown on Windows

**Classification:** Bug
**Severity:** Medium
**Themes:** Output correctness
**URL:** https://github.com/posit-dev/positron/issues/4580

**Environment:**
- OS: Windows, macOS, Linux
- Runtime: Python, R

**Primary Symptom:**
Output from reticulated Python is not shown in the R console on Windows. For example: ```r...

---

#### Issue #4502: Attempting to return a polars lazyframe removes the console

**Classification:** Bug
**Severity:** Medium
**Themes:** Focus + input targeting, Startup reliability, Output correctness, Session/runtime integration, Interaction behaviors, Resource visibility, Workspace context, Performance
**URL:** https://github.com/posit-dev/positron/issues/4502

**Environment:**
- Runtime: Python, R

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://github.com/posit-dev/positron/wiki/Feedback-and-Issues...

---

#### Issue #4456: Every command in the Python console returns the object’s creation message

**Classification:** Bug
**Severity:** Medium
**Themes:** Startup reliability, Output correctness, Session/runtime integration, Workspace context
**URL:** https://github.com/posit-dev/positron/issues/4456

**Environment:**
- Runtime: Python

**Primary Symptom:**
Thanks for taking the time to file an issue! Take a look at our guidance on feedback and issues: https://github.com/posit-dev/positron/wiki/Feedback-and-Issues...

---

#### Issue #4447: Cancel multiline input with `Esc` at console

**Classification:** Enhancement
**Severity:** High
**Themes:** Focus + input targeting, Startup reliability, Interaction behaviors, Resource visibility, Performance
**URL:** https://github.com/posit-dev/positron/issues/4447

**Environment:**
- Not specified in issue text

**Primary Symptom:**
Multiline input at the console cannot be cancelled with `Esc` but only `ctrl`+`c`: ![Kapture 2024-08-23 at 02 33 10](https://github.com/user-attachments/assets/8f8f46a4-a2f5-44ad-a1f2-eb632004e56f) I ...

---

#### Issue #4445: R: Console doesn't scroll down to input line when focused

**Classification:** Bug
**Severity:** Medium
**Themes:** Focus + input targeting, Startup reliability, Interaction behaviors
**URL:** https://github.com/posit-dev/positron/issues/4445

**Environment:**
- Not specified in issue text

**Primary Symptom:**
When I use the RStudio keymap shortcut `ctrl`+`2` to focus the console, it does not scroll down to the input line. I was often confused if the console was focused or if I had not pressed the keys down...

---

#### Issue #4294: Option to open session/console in a floating window

**Classification:** Enhancement
**Severity:** Medium
**Themes:** Output correctness, Session/runtime integration, Resource visibility
**URL:** https://github.com/posit-dev/positron/issues/4294

**Environment:**
- Not specified in issue text

**Primary Symptom:**
### Discussed in https://github.com/posit-dev/positron/discussions/4284 <div type='discussions-op-text'> <sup>Originally posted by **wurli** August  8, 2024</sup>...

---

## A2 — Requirements Derived From Open Issues

These are unmet requirements extracted from open console issues, grouped by theme.

### Focus + input targeting

- Console must "ctrl+n" keybinding does not work in the r (Issue #9500)
- Console must `"editor.acceptsuggestiononenter": "smart"` apply to our ? (Issue #8803)
- Console must cannot scroll within multiline statements in r (Issue #8738)
- Console must input prompt does not focus when an activity input prompt ends (Issue #8687)
- Console must no completions in new, experimental notebook s (Issue #11157)
- Console must support: Can't correctly paste into Python `input()` or R `menu()` prompt in the console on Windows (Issue #8201)
- Console must support: Console: Poor/no feedback when kernel is unreachable (Issue #10411)
- Console must support: Console: Return of the Dancing Consoles (flipping between R/Python at boot) (Issue #10929)
- Console must support: LSP in the console: let language servers statically analyze console history (Issue #10972)
- Console must support: Output from later/promises doesn't get matched to correct console input (Issue #9530)

### Startup reliability

- Console must can get stuck "starting..." forever if extension host does not start (Issue #10582)
- Console must python  intermittently fails to restart properly (restart button on  action bar) (Issue #10016)
- Console must support: Console: Mechanism to select start folder in multi-root workspace (Issue #11478)
- Console must support: Console: Poor/no feedback when kernel is unreachable (Issue #10411)
- Console must support: Console: Return of the Dancing Consoles (flipping between R/Python at boot) (Issue #10929)
- Console must support: Implement file paste and drop for the console (Issue #10204)
- Console must support: Session nicknames need a different treatment in, e.g., "exited" or "restarted" console messages (Issue #10767)
- Console must support: Show indicator on Positron consoles that need to be restarted to apply changes (Issue #11031)
- Console must support: Startup of console hangs the first time starting positron after upgrade (Issue #11230)
- Console must support: Text is added on the R console output (Issue #11627)

### Output correctness

- Console must : double-clicking text should select it, not jump to the bottom (Issue #11411)
- Console must : resource usage not visible when there is only one session (Issue #11458)
- Console must no completions in new, experimental notebook s (Issue #11157)
- Console must notebook s: plots rendered as tiny, useless thumbnails with broken inspector (Issue #11142)
- Console must support: Inline display of plots in Console (Issue #11104)
- Console must support: Plots are only rendered at the end of a loop (Issue #11519)
- Console must support: Show indicator on Positron consoles that need to be restarted to apply changes (Issue #11031)
- Console must support: Startup of console hangs the first time starting positron after upgrade (Issue #11230)
- Console must support: Text is added on the R console output (Issue #11627)
- Console must windows conda s not working (Issue #11221)

### Session/runtime integration

- Console must : resource usage not visible when there is only one session (Issue #11458)
- Console must no completions in new, experimental notebook s (Issue #11157)
- Console must notebook s: plots rendered as tiny, useless thumbnails with broken inspector (Issue #11142)
- Console must support: Console: Mechanism to select start folder in multi-root workspace (Issue #11478)
- Console must support: Console: Return of the Dancing Consoles (flipping between R/Python at boot) (Issue #10929)
- Console must support: LSP in the console: let language servers statically analyze console history (Issue #10972)
- Console must support: Show indicator on Positron consoles that need to be restarted to apply changes (Issue #11031)
- Console must support: Startup of console hangs the first time starting positron after upgrade (Issue #11230)
- Console must support: Text is added on the R console output (Issue #11627)
- Console must windows conda s not working (Issue #11221)

### Interaction behaviors

- Console must "ctrl+n" keybinding does not work in the r (Issue #9500)
- Console must : double-clicking text should select it, not jump to the bottom (Issue #11411)
- Console must notebook: notebook s don't show plots or html widgets (Issue #9699)
- Console must python  intermittently fails to restart properly (restart button on  action bar) (Issue #10016)
- Console must support: Columns with a URL that are abbreviated in the console change the actual content of that column (when clicking). (Issue #9856)
- Console must support: Console: Mechanism to select start folder in multi-root workspace (Issue #11478)
- Console must support: Console: Poor/no feedback when kernel is unreachable (Issue #10411)
- Console must support: Implement file paste and drop for the console (Issue #10204)
- Console must support: LSP in the console: let language servers statically analyze console history (Issue #10972)
- Console must support: Text is added on the R console output (Issue #11627)

### Resource visibility

- Console must : resource usage not visible when there is only one session (Issue #11458)
- Console must : variables within contributed environment variables do not resolve (Issue #9123)
- Console must notebook: notebook s don't show plots or html widgets (Issue #9699)
- Console must python  intermittently fails to restart properly (restart button on  action bar) (Issue #10016)
- Console must support: Console: Option to hide sidebar/console tab list (Issue #8912)
- Console must support: Improve treatment for xarray objects in Console and Variables pane (Issue #10852)
- Console must support: LSP in the console: let language servers statically analyze console history (Issue #10972)
- Console must support: Plots are only rendered at the end of a loop (Issue #11519)
- Console must support: Show indicator on Positron consoles that need to be restarted to apply changes (Issue #11031)
- Console must windows conda s not working (Issue #11221)

### Workspace context

- Console must notebooks: when a notebook  is active, autocompletion does not work in scripts (Issue #9759)
- Console must python  intermittently fails to restart properly (restart button on  action bar) (Issue #10016)
- Console must support: Console: Mechanism to select start folder in multi-root workspace (Issue #11478)
- Console must support: Console: Return of the Dancing Consoles (flipping between R/Python at boot) (Issue #10929)
- Console must support: Implement file paste and drop for the console (Issue #10204)
- Console must support: Improve treatment for xarray objects in Console and Variables pane (Issue #10852)
- Console must support: Queued code in one R session breaks LSP in other R session (Issue #9755)
- Console must support: Startup of console hangs the first time starting positron after upgrade (Issue #11230)
- Console must support: Text is added on the R console output (Issue #11627)
- Console must windows conda s not working (Issue #11221)

### Performance

- Console must can get stuck "starting..." forever if extension host does not start (Issue #10582)
- Console must support: Absent action/behavior for 'Show Active Interpreter Session Profile Report' (workbench.action.languageRuntime.showProfile) (Issue #7903)
- Console must support: Columns with a URL that are abbreviated in the console change the actual content of that column (when clicking). (Issue #9856)
- Console must support: Console: "Extensions restarting..." flashes when closing, switching workspaces, etc. (Issue #8145)
- Console must support: Console: Mechanism to select start folder in multi-root workspace (Issue #11478)
- Console must support: Console: Poor/no feedback when kernel is unreachable (Issue #10411)
- Console must support: Console: Reduce code execution latency by reducing roundtrips (Issue #8915)
- Console must support: Show indicator on Positron consoles that need to be restarted to apply changes (Issue #11031)
- Console must support: Slow startup (time to interactive R console) (Issue #9449)
- Console must support: Startup of console hangs the first time starting positron after upgrade (Issue #11230)

## A3 — Clustering of Open Problems

### Cluster: Session/runtime integration

**Issue Count:** 77

**Issues Included:**
- #11627: Text is added on the R console output
- #11478: Console: Mechanism to select start folder in multi-root workspace
- #11458: Console: Resource usage not visible when there is only one session
- #11230: Startup of console hangs the first time starting positron after upgrade
- #11221: Windows conda consoles not working
- #11157: No completions in new, experimental notebook consoles
- #11142: Notebook consoles: Plots rendered as tiny, useless thumbnails with broken inspector
- #11031: Show indicator on Positron consoles that need to be restarted to apply changes
- #10972: LSP in the console: let language servers statically analyze console history
- #10929: Console: Return of the Dancing Consoles (flipping between R/Python at boot)
- #10767: Session nicknames need a different treatment in, e.g., "exited" or "restarted" console messages
- #10582: Console can get stuck "Starting..." forever if extension host does not start
- #10411: Console: Poor/no feedback when kernel is unreachable
- #10016: Python console intermittently fails to restart properly (restart button on console action bar)
- #9759: Notebooks: When a notebook console is active, autocompletion does not work in scripts
- #9755: Queued code in one R session breaks LSP in other R session
- #9699: Notebook: Notebook consoles don't show plots or HTML widgets
- #9500: "Ctrl+n" keybinding does not work in the R console
- #9486: cat(msg) appends a newline even if 'msg' doesn't have one
- #9449: Slow startup (time to interactive R console)
- *...and 57 more*

**Common Failure Mode:**
Primarily Bug issues affecting session/runtime integration

**Suspected Subsystem:**
Runtime supervisor, kernel integration, interpreter bridge

---

### Cluster: Output correctness

**Issue Count:** 71

**Issues Included:**
- #11627: Text is added on the R console output
- #11519: Plots are only rendered at the end of a loop
- #11458: Console: Resource usage not visible when there is only one session
- #11411: console: double-clicking text should select it, not jump to the bottom
- #11230: Startup of console hangs the first time starting positron after upgrade
- #11221: Windows conda consoles not working
- #11157: No completions in new, experimental notebook consoles
- #11142: Notebook consoles: Plots rendered as tiny, useless thumbnails with broken inspector
- #11104: Inline display of plots in Console
- #11031: Show indicator on Positron consoles that need to be restarted to apply changes
- #10852: Improve treatment for xarray objects in Console and Variables pane
- #10582: Console can get stuck "Starting..." forever if extension host does not start
- #10416: R Console Formatting of `message()` and `warning()`
- #10411: Console: Poor/no feedback when kernel is unreachable
- #10204: Implement file paste and drop for the console
- #10016: Python console intermittently fails to restart properly (restart button on console action bar)
- #9759: Notebooks: When a notebook console is active, autocompletion does not work in scripts
- #9755: Queued code in one R session breaks LSP in other R session
- #9699: Notebook: Notebook consoles don't show plots or HTML widgets
- #9530: Output from later/promises doesn't get matched to correct console input
- *...and 51 more*

**Common Failure Mode:**
Primarily Bug issues affecting output correctness

**Suspected Subsystem:**
Renderer, ANSI parser, display formatting

---

### Cluster: Startup reliability

**Issue Count:** 46

**Issues Included:**
- #11627: Text is added on the R console output
- #11478: Console: Mechanism to select start folder in multi-root workspace
- #11230: Startup of console hangs the first time starting positron after upgrade
- #11031: Show indicator on Positron consoles that need to be restarted to apply changes
- #10929: Console: Return of the Dancing Consoles (flipping between R/Python at boot)
- #10767: Session nicknames need a different treatment in, e.g., "exited" or "restarted" console messages
- #10582: Console can get stuck "Starting..." forever if extension host does not start
- #10411: Console: Poor/no feedback when kernel is unreachable
- #10204: Implement file paste and drop for the console
- #10016: Python console intermittently fails to restart properly (restart button on console action bar)
- #9755: Queued code in one R session breaks LSP in other R session
- #9449: Slow startup (time to interactive R console)
- #9208: Positron can't render progress bar powered by `ipywidgets`
- #8915: Console: Reduce code execution latency by reducing roundtrips
- #8803: Should `"editor.acceptSuggestionOnEnter": "smart"` apply to our console?
- #8738: Cannot scroll within multiline statements in R Console
- #8682: Sometimes complex values don't print in the R Console the first time
- #8450: Respect `options(shiny.launch.browser = TRUE)` when running R Shiny apps in the Console
- #8447: Un-register interpreter when a runtime is removed by user
- #8333: Python console often gets stuck in Restarting state
- *...and 26 more*

**Common Failure Mode:**
Primarily Bug issues affecting startup reliability

**Suspected Subsystem:**
Extension host, runtime supervisor, initialization logic

---

### Cluster: Interaction behaviors

**Issue Count:** 40

**Issues Included:**
- #11627: Text is added on the R console output
- #11478: Console: Mechanism to select start folder in multi-root workspace
- #11411: console: double-clicking text should select it, not jump to the bottom
- #10972: LSP in the console: let language servers statically analyze console history
- #10411: Console: Poor/no feedback when kernel is unreachable
- #10204: Implement file paste and drop for the console
- #10016: Python console intermittently fails to restart properly (restart button on console action bar)
- #9856: Columns with a URL that are abbreviated in the console change the actual content of that column (when clicking).
- #9699: Notebook: Notebook consoles don't show plots or HTML widgets
- #9500: "Ctrl+n" keybinding does not work in the R console
- #9449: Slow startup (time to interactive R console)
- #8803: Should `"editor.acceptSuggestionOnEnter": "smart"` apply to our console?
- #8738: Cannot scroll within multiline statements in R Console
- #8690: Cannot clear line when in pdb
- #8471: Console: Pasting can jitter the console preventing it from auto scrolling
- #8447: Un-register interpreter when a runtime is removed by user
- #8201: Can't correctly paste into Python `input()` or R `menu()` prompt in the console on Windows
- #8173: Cmd + click on link in Console asks about an external URI opener
- #8047: Split or fork an existing console
- #7903: Absent action/behavior for 'Show Active Interpreter Session Profile Report' (workbench.action.languageRuntime.showProfile)
- *...and 20 more*

**Common Failure Mode:**
Primarily Bug issues affecting interaction behaviors

**Suspected Subsystem:**
Event handlers, UI state management, history buffer

---

### Cluster: Workspace context

**Issue Count:** 38

**Issues Included:**
- #11627: Text is added on the R console output
- #11478: Console: Mechanism to select start folder in multi-root workspace
- #11230: Startup of console hangs the first time starting positron after upgrade
- #11221: Windows conda consoles not working
- #10929: Console: Return of the Dancing Consoles (flipping between R/Python at boot)
- #10852: Improve treatment for xarray objects in Console and Variables pane
- #10204: Implement file paste and drop for the console
- #10016: Python console intermittently fails to restart properly (restart button on console action bar)
- #9759: Notebooks: When a notebook console is active, autocompletion does not work in scripts
- #9755: Queued code in one R session breaks LSP in other R session
- #9449: Slow startup (time to interactive R console)
- #9208: Positron can't render progress bar powered by `ipywidgets`
- #8803: Should `"editor.acceptSuggestionOnEnter": "smart"` apply to our console?
- #8682: Sometimes complex values don't print in the R Console the first time
- #8450: Respect `options(shiny.launch.browser = TRUE)` when running R Shiny apps in the Console
- #8173: Cmd + click on link in Console asks about an external URI opener
- #8145: Console: "Extensions restarting..." flashes when closing, switching workspaces, etc.
- #7903: Absent action/behavior for 'Show Active Interpreter Session Profile Report' (workbench.action.languageRuntime.showProfile)
- #7517: Progress from progressr R package prints too many newlines
- #7296: Cannot use ctrl+enter to excute code in some situations
- *...and 18 more*

**Common Failure Mode:**
Primarily Bug issues affecting workspace context

**Suspected Subsystem:**
Console core, integration layer

---

### Cluster: Focus + input targeting

**Issue Count:** 25

**Issues Included:**
- #11157: No completions in new, experimental notebook consoles
- #10972: LSP in the console: let language servers statically analyze console history
- #10929: Console: Return of the Dancing Consoles (flipping between R/Python at boot)
- #10411: Console: Poor/no feedback when kernel is unreachable
- #9530: Output from later/promises doesn't get matched to correct console input
- #9500: "Ctrl+n" keybinding does not work in the R console
- #8803: Should `"editor.acceptSuggestionOnEnter": "smart"` apply to our console?
- #8738: Cannot scroll within multiline statements in R Console
- #8687: Console input prompt does not focus when an activity input prompt ends
- #8201: Can't correctly paste into Python `input()` or R `menu()` prompt in the console on Windows
- #7575: Epic: Assistant: Support Inline Chat for Console
- #7118: Console: Unable to focus after Notebook + Max Aux Bar View
- #7100: Python: Cursor skips to end of function after an empty line
- #6895: Console Restore: Continuation prompts not restored
- #6048: Provide a keybinding for navigating inside the Panel (esp to/from the Console)
- #5797: Create new command to interpolate text into code, to run in the console
- #5710: Windows: `Ctrl + C` is unreliable to interrupt a `readline()`
- #5452: Should execution mode be handled by the main thread rather than runtimes?
- #5272: Frontend should break up multiline selections that get sent to Console by complete expressions
- #5189: Unexpected continuation prompt on Enter due to conflict between completions and console
- *...and 5 more*

**Common Failure Mode:**
Primarily Bug issues affecting focus + input targeting

**Suspected Subsystem:**
Frontend focus manager, keyboard event handling

---

### Cluster: Resource visibility

**Issue Count:** 20

**Issues Included:**
- #11519: Plots are only rendered at the end of a loop
- #11458: Console: Resource usage not visible when there is only one session
- #11221: Windows conda consoles not working
- #11031: Show indicator on Positron consoles that need to be restarted to apply changes
- #10972: LSP in the console: let language servers statically analyze console history
- #10852: Improve treatment for xarray objects in Console and Variables pane
- #10016: Python console intermittently fails to restart properly (restart button on console action bar)
- #9699: Notebook: Notebook consoles don't show plots or HTML widgets
- #9123: Console: Variables within contributed environment variables do not resolve 
- #8912: Console: Option to hide sidebar/console tab list
- #8803: Should `"editor.acceptSuggestionOnEnter": "smart"` apply to our console?
- #8450: Respect `options(shiny.launch.browser = TRUE)` when running R Shiny apps in the Console
- #8000: R console failing to start
- #7138: Positron's Python (seems) do not respect Conda environment variables when calling other CLI tools using Python
- #6986: multi-console: reconsider approach to console history (separate histories per session)
- #6054: Unreliable display of `xarray` Dataset metadata
- #5840: Python: Improve the discovery of the %view magic use in the Console to view Data Frames
- #4502: Attempting to return a polars lazyframe removes the console
- #4447: Cancel multiline input with `Esc` at console
- #4294: Option to open session/console in a floating window

**Common Failure Mode:**
Primarily Bug issues affecting resource visibility

**Suspected Subsystem:**
Console core, integration layer

---

### Cluster: Performance

**Issue Count:** 17

**Issues Included:**
- #11478: Console: Mechanism to select start folder in multi-root workspace
- #11230: Startup of console hangs the first time starting positron after upgrade
- #11031: Show indicator on Positron consoles that need to be restarted to apply changes
- #10582: Console can get stuck "Starting..." forever if extension host does not start
- #10411: Console: Poor/no feedback when kernel is unreachable
- #9856: Columns with a URL that are abbreviated in the console change the actual content of that column (when clicking).
- #9449: Slow startup (time to interactive R console)
- #8915: Console: Reduce code execution latency by reducing roundtrips
- #8145: Console: "Extensions restarting..." flashes when closing, switching workspaces, etc.
- #7903: Absent action/behavior for 'Show Active Interpreter Session Profile Report' (workbench.action.languageRuntime.showProfile)
- #7517: Progress from progressr R package prints too many newlines
- #6812: Consider removing debounce on `notifyForegroundSessionChanged` in favor of extension side handling
- #5452: Should execution mode be handled by the main thread rather than runtimes?
- #5272: Frontend should break up multiline selections that get sent to Console by complete expressions
- #4850: Cannot run code in Working Tree
- #4502: Attempting to return a polars lazyframe removes the console
- #4447: Cancel multiline input with `Esc` at console

**Common Failure Mode:**
Primarily Bug issues affecting performance

**Suspected Subsystem:**
Console core, integration layer

---

## A4 — Statistical Analysis (Open Issues Only)

### Counts

**Total Open Console Issues:** 100

**By Type:**
- Bug: 72 (72.0%)
- Enhancement: 28 (28.0%)

**By Runtime:**
- R: 50
- Python: 41
- Conda: 3

**By Platform:**
- Windows: 13
- Linux: 7
- macOS: 5

### Theme Frequency Ranking

| Rank | Theme | Count | % of Issues |
|------|-------|-------|-------------|
| 1 | Session/runtime integration | 77 | 77.0% |
| 2 | Output correctness | 71 | 71.0% |
| 3 | Startup reliability | 46 | 46.0% |
| 4 | Interaction behaviors | 40 | 40.0% |
| 5 | Workspace context | 38 | 38.0% |
| 6 | Focus + input targeting | 25 | 25.0% |
| 7 | Resource visibility | 20 | 20.0% |
| 8 | Performance | 17 | 17.0% |
| 9 | Other | 2 | 2.0% |

### Severity Distribution

**Critical:** 3 (3.0%)
- *Blocks console use entirely, crashes, or makes core functionality unusable*

**High:** 13 (13.0%)
- *Major workflow disruption, frequent failures, or significant UX problems*

**Medium:** 80 (80.0%)
- *Noticeable issues that affect user experience but have workarounds*

**Low:** 4 (4.0%)
- *Minor UX gaps, cosmetic issues, or enhancement requests*

## A5 — QA + Regression Testing Implications

### Session/runtime integration (77 issues)

**High-Value Verification Tests:**
1. Test runtime restart and reconnection flows
2. Verify interpreter switching (Python/R)
3. Test Conda environment activation
4. Validate session state persistence

**Key Regression Risks:**
- 15 high-severity issues in this cluster
- Affects multiple platforms/runtimes
- May impact core console usability

**Coverage Gaps:**
- Windows-specific testing needed
- Conda environment coverage
- First-run and cold-start scenarios
- Edge cases with rapid state changes

---

### Output correctness (71 issues)

**High-Value Verification Tests:**
1. Verify ANSI color rendering across platforms
2. Test output formatting with large data structures
3. Validate Unicode and special character display
4. Test output buffering and streaming behavior

**Key Regression Risks:**
- 13 high-severity issues in this cluster
- Affects multiple platforms/runtimes
- May impact core console usability

**Coverage Gaps:**
- Windows-specific testing needed
- Conda environment coverage
- First-run and cold-start scenarios
- Edge cases with rapid state changes

---

### Startup reliability (46 issues)

**High-Value Verification Tests:**
1. Test cold start with various interpreter configurations
2. Verify session initialization with/without active projects
3. Test startup with Conda environments
4. Validate first-run experience on clean install

**Key Regression Risks:**
- 11 high-severity issues in this cluster
- Affects multiple platforms/runtimes
- May impact core console usability

**Coverage Gaps:**
- Windows-specific testing needed
- Conda environment coverage
- First-run and cold-start scenarios
- Edge cases with rapid state changes

---

### Interaction behaviors (40 issues)

**High-Value Verification Tests:**
1. Test scroll position retention during execution
2. Verify history navigation (up/down arrows)
3. Test selection and copy/paste operations
4. Validate clear console behavior

**Key Regression Risks:**
- 8 high-severity issues in this cluster
- Affects multiple platforms/runtimes
- May impact core console usability

**Coverage Gaps:**
- Windows-specific testing needed
- Conda environment coverage
- First-run and cold-start scenarios
- Edge cases with rapid state changes

---

### Workspace context (38 issues)

**High-Value Verification Tests:**
1. Regression test core functionality
2. Verify cross-platform compatibility
3. Test edge cases and error conditions
4. Validate integration with other components

**Key Regression Risks:**
- 8 high-severity issues in this cluster
- Affects multiple platforms/runtimes
- May impact core console usability

**Coverage Gaps:**
- Windows-specific testing needed
- Conda environment coverage
- First-run and cold-start scenarios
- Edge cases with rapid state changes

---


# REPORT B — CLOSED ISSUES ANALYSIS

## B1 — Issue Inventory (Closed Issues)

### Summary Table

| # | Title | What Was Fixed | Classification |
|---|-------|----------------|----------------|
| [#11533](https://github.com/posit-dev/positron/issues/11533) | Ctrl+Enter on code in an unsaved R file doesn't ex... | Ctrl+Enter on code in an unsaved R file doesn't execute anymore (daily, 2026.02.... | Bug |
| [#11402](https://github.com/posit-dev/positron/issues/11402) | Ctrl+R and Cmd+Up are not aware of independent con... | Ctrl+R and Cmd+Up are not aware of independent console history for debugging | Bug |
| [#10798](https://github.com/posit-dev/positron/issues/10798) | Console crash shortly after a windows reload | Console crash shortly after a windows reload | Bug |
| [#10713](https://github.com/posit-dev/positron/issues/10713) | Keep "Cmd click to launch VS Code Native REPL" fro... | Keep "Cmd click to launch VS Code Native REPL" from appearing in the Python cons... | Bug |
| [#10593](https://github.com/posit-dev/positron/issues/10593) | Wrong JSON typing for console.fontLigatures | Wrong JSON typing for console.fontLigatures | Bug |
| [#10518](https://github.com/posit-dev/positron/issues/10518) | Right click on output shows right click options fo... | Right click on output shows right click options for a notebook cell | Bug |
| [#10446](https://github.com/posit-dev/positron/issues/10446) | Fix and Explain console actions are missing on Win... | Fix and Explain console actions are missing on Windows | Bug |
| [#10382](https://github.com/posit-dev/positron/issues/10382) | Python DataFrame display in console adds a lot of ... | Python DataFrame display in console adds a lot of extra space | Bug |
| [#10376](https://github.com/posit-dev/positron/issues/10376) | Ctrl+Enter Fails to Execute R Code with dplyr Pipe... | Ctrl+Enter Fails to Execute R Code with dplyr Pipe and Multi-line Code Blocks | Enhancement |
| [#10158](https://github.com/posit-dev/positron/issues/10158) | Can't interrupt selection/activity prompts on Wind... | Can't interrupt selection/activity prompts on Windows | Bug |
| [#10058](https://github.com/posit-dev/positron/issues/10058) | Copying text from console with context menu adds `... | Copying text from console with context menu adds `nbsp` instead of spaces | Bug |
| [#10045](https://github.com/posit-dev/positron/issues/10045) | Running Python module imports from subdirectories ... | Running Python module imports from subdirectories interactively | Enhancement |
| [#9761](https://github.com/posit-dev/positron/issues/9761) | Console: Code run from a script should be run in a... | Console: Code run from a script should be run in a console session, not a notebo... | Bug |
| [#9576](https://github.com/posit-dev/positron/issues/9576) | Relax or remove active session limit | Relax or remove active session limit | Bug |
| [#9469](https://github.com/posit-dev/positron/issues/9469) | Console: Failed to delete session: {0} | Console: Failed to delete session: {0} | Bug |
| [#9467](https://github.com/posit-dev/positron/issues/9467) | Crash when interrupting after immediately submitti... | Crash when interrupting after immediately submitting command | Bug |
| [#9407](https://github.com/posit-dev/positron/issues/9407) | Session can error and be corrupted when re-connect... | Session can error and be corrupted when re-connecting in Workbench/web | Bug |
| [#9215](https://github.com/posit-dev/positron/issues/9215) | Cannot start R or Python sessions: HttpError HTTP ... | Cannot start R or Python sessions: HttpError HTTP request failed | Bug |
| [#9211](https://github.com/posit-dev/positron/issues/9211) | R console not loading .RProfile on startup | R console not loading .RProfile on startup | Bug |
| [#8924](https://github.com/posit-dev/positron/issues/8924) | UX: When having multiple sessions with the same na... | UX: When having multiple sessions with the same name, add a unique identifier? | Enhancement |
| [#8559](https://github.com/posit-dev/positron/issues/8559) | Regression: Can no longer step through multi-line ... | Regression: Can no longer step through multi-line `@examples` one line at a time | Bug |
| [#8507](https://github.com/posit-dev/positron/issues/8507) | Unwanted `Cmd click to launch VS Code Native REPL`... | Unwanted `Cmd click to launch VS Code Native REPL` in Python Console startup | Bug |
| [#8443](https://github.com/posit-dev/positron/issues/8443) | Allow the console font to be independently configu... | Allow the console font to be independently configured | Enhancement |
| [#8303](https://github.com/posit-dev/positron/issues/8303) | Can't close console that has failed to start | Can't close console that has failed to start | Bug |
| [#7995](https://github.com/posit-dev/positron/issues/7995) | Erroneous python log messages in console when idle | Erroneous python log messages in console when idle | Bug |
| [#7884](https://github.com/posit-dev/positron/issues/7884) | multisessions: with exited sessions the `+` sessio... | multisessions: with exited sessions the `+` session menu is missing active sessi... | Bug |
| [#7854](https://github.com/posit-dev/positron/issues/7854) | multisessions: `+` button does not dedupe prior to... | multisessions: `+` button does not dedupe prior to limiting to 5 | Bug |
| [#7776](https://github.com/posit-dev/positron/issues/7776) | Leaked Disposables: DropdownWithPrimaryActionViewI... | Leaked Disposables: DropdownWithPrimaryActionViewItem | Bug |
| [#7693](https://github.com/posit-dev/positron/issues/7693) | Multisessions: Cannot read properties of null (rea... | Multisessions: Cannot read properties of null (reading 'offsetParent') | Bug |
| [#7692](https://github.com/posit-dev/positron/issues/7692) | Multisessions: Session rename does not persist aft... | Multisessions: Session rename does not persist after reload (web only) | Bug |
| [#7691](https://github.com/posit-dev/positron/issues/7691) | When executing code by command, pre-existing code ... | When executing code by command, pre-existing code in the Console should not run ... | Bug |
| [#7681](https://github.com/posit-dev/positron/issues/7681) | `demo(graphics)` is not interactive the first time... | `demo(graphics)` is not interactive the first time around | Bug |
| [#7619](https://github.com/posit-dev/positron/issues/7619) | history search in console by Ctrl-R acts weird wit... | history search in console by Ctrl-R acts weird with the letter "p" | Bug |
| [#7579](https://github.com/posit-dev/positron/issues/7579) | e2e test: add new multisession accessibility test | e2e test: add new multisession accessibility test | Enhancement |
| [#7578](https://github.com/posit-dev/positron/issues/7578) | e2e test: add new multisession rename test | e2e test: add new multisession rename test | Enhancement |
| [#7576](https://github.com/posit-dev/positron/issues/7576) | python: cannot run `pip uninstall ....` in console | python: cannot run `pip uninstall ....` in console | Bug |
| [#7522](https://github.com/posit-dev/positron/issues/7522) | Creating a Console doesn't raise or focus the Cons... | Creating a Console doesn't raise or focus the Console tab | Bug |
| [#7423](https://github.com/posit-dev/positron/issues/7423) | Test: Fix runtimeSessionService unit tests | Test: Fix runtimeSessionService unit tests | Bug |
| [#7413](https://github.com/posit-dev/positron/issues/7413) | Console: Improved Busy Session Deletion | Console: Improved Busy Session Deletion | Bug |
| [#7340](https://github.com/posit-dev/positron/issues/7340) | Console: Duplicate session names when creating a s... | Console: Duplicate session names when creating a session after reloading | Bug |
| [#7332](https://github.com/posit-dev/positron/issues/7332) | Remove Multi Console Session Feature Flag | Remove Multi Console Session Feature Flag | Performance |
| [#7274](https://github.com/posit-dev/positron/issues/7274) | [Bug] Positron console fails to inherit PATH "User... | [Bug] Positron console fails to inherit PATH "User Variables" on Windows | Bug |
| [#7252](https://github.com/posit-dev/positron/issues/7252) | History only 4 lines long | History only 4 lines long | Bug |
| [#7205](https://github.com/posit-dev/positron/issues/7205) | "Silent" code execution prints the command to cons... | "Silent" code execution prints the command to console when in queue | Bug |
| [#7187](https://github.com/posit-dev/positron/issues/7187) | If you shut down then restart an interpreter, Posi... | If you shut down then restart an interpreter, Positron starts a new session | Bug |
| [#7096](https://github.com/posit-dev/positron/issues/7096) | Multisession: changing browser can result in disco... | Multisession: changing browser can result in disconnected or lost sessions | Bug |
| [#7005](https://github.com/posit-dev/positron/issues/7005) | Console Multisessions: new session created when us... | Console Multisessions: new session created when user clicks on disconnected sess... | Bug |
| [#6987](https://github.com/posit-dev/positron/issues/6987) | Restarting Python Session, State Incorrect | Restarting Python Session, State Incorrect | Bug |
| [#6985](https://github.com/posit-dev/positron/issues/6985) | Console/Supervisor: Support Extension Environment ... | Console/Supervisor: Support Extension Environment Contributions API | Enhancement |
| [#6914](https://github.com/posit-dev/positron/issues/6914) | A user should be able to open the entire Console h... | A user should be able to open the entire Console history in an Editor. | Enhancement |

*Note: Showing first 50 of 100 issues. Full details in appendix.*

## B2 — Requirements Confirmed by Closed Issues

These are established behaviors now guaranteed by the Console, derived from resolved issues.

### Focus + input targeting

- Console now guarantees : code run from a script should be run in a  session, not a notebook session (Fixed in #9761)
- Console now guarantees : input prompt truncated on startup (Fixed in #6845)
- Console now guarantees copying text from  with context menu adds `nbsp` instead of spaces (Fixed in #10058)
- Console now guarantees creating a  doesn't raise or focus the  tab (Fixed in #7522)
- Console now guarantees ctrl+enter fails to execute r code with dplyr pipe and multi-line code blocks (Fixed in #10376)
- Console now guarantees e2e test:  session tab list (Fixed in #6347)
- Console now guarantees multisession : cannot restart session after force-quit (Fixed in #6881)
- Console now guarantees multisessions: keyboard accessibility / mouse control issues (Fixed in #6451)
- Console now guarantees the  shows a text cursor when it shouldn't (Fixed in #6585)
- Console now guarantees wrong json typing for .fontligatures (Fixed in #10593)

### Startup reliability

- Console now guarantees can't interrupt selection/activity prompts on windows (Fixed in #10158)
- Console now guarantees copying text from  with context menu adds `nbsp` instead of spaces (Fixed in #10058)
- Console now guarantees crash shortly after a windows reload (Fixed in #10798)
- Console now guarantees crash when interrupting after immediately submitting command (Fixed in #9467)
- Console now guarantees ctrl+enter fails to execute r code with dplyr pipe and multi-line code blocks (Fixed in #10376)
- Console now guarantees ctrl+enter on code in an unsaved r file doesn't execute anymore (daily, 2026.02.0-104) (Fixed in #11533)
- Console now guarantees keep "cmd click to launch vs code native repl" from appearing in the python (Fixed in #10713)
- Console now guarantees relax or remove active session limit (Fixed in #9576)
- Console now guarantees right click on output shows right click options for a notebook cell (Fixed in #10518)
- Console now guarantees session can error and be corrupted when re-connecting in workbench/web (Fixed in #9407)

### Output correctness

- Console now guarantees can't interrupt selection/activity prompts on windows (Fixed in #10158)
- Console now guarantees crash shortly after a windows reload (Fixed in #10798)
- Console now guarantees ctrl+enter fails to execute r code with dplyr pipe and multi-line code blocks (Fixed in #10376)
- Console now guarantees ctrl+enter on code in an unsaved r file doesn't execute anymore (daily, 2026.02.0-104) (Fixed in #11533)
- Console now guarantees ctrl+r and cmd+up are not aware of independent  history for debugging (Fixed in #11402)
- Console now guarantees fix and explain  actions are missing on windows (Fixed in #10446)
- Console now guarantees keep "cmd click to launch vs code native repl" from appearing in the python (Fixed in #10713)
- Console now guarantees python dataframe display in  adds a lot of extra space (Fixed in #10382)
- Console now guarantees right click on output shows right click options for a notebook cell (Fixed in #10518)
- Console now guarantees wrong json typing for .fontligatures (Fixed in #10593)

### Session/runtime integration

- Console now guarantees can't interrupt selection/activity prompts on windows (Fixed in #10158)
- Console now guarantees copying text from  with context menu adds `nbsp` instead of spaces (Fixed in #10058)
- Console now guarantees crash shortly after a windows reload (Fixed in #10798)
- Console now guarantees ctrl+enter fails to execute r code with dplyr pipe and multi-line code blocks (Fixed in #10376)
- Console now guarantees ctrl+enter on code in an unsaved r file doesn't execute anymore (daily, 2026.02.0-104) (Fixed in #11533)
- Console now guarantees ctrl+r and cmd+up are not aware of independent  history for debugging (Fixed in #11402)
- Console now guarantees python dataframe display in  adds a lot of extra space (Fixed in #10382)
- Console now guarantees right click on output shows right click options for a notebook cell (Fixed in #10518)
- Console now guarantees running python module imports from subdirectories interactively (Fixed in #10045)
- Console now guarantees wrong json typing for .fontligatures (Fixed in #10593)

### Interaction behaviors

- Console now guarantees : code run from a script should be run in a  session, not a notebook session (Fixed in #9761)
- Console now guarantees can't interrupt selection/activity prompts on windows (Fixed in #10158)
- Console now guarantees cannot start r or python sessions: httperror http request failed (Fixed in #9215)
- Console now guarantees copying text from  with context menu adds `nbsp` instead of spaces (Fixed in #10058)
- Console now guarantees crash when interrupting after immediately submitting command (Fixed in #9467)
- Console now guarantees ctrl+enter fails to execute r code with dplyr pipe and multi-line code blocks (Fixed in #10376)
- Console now guarantees ctrl+r and cmd+up are not aware of independent  history for debugging (Fixed in #11402)
- Console now guarantees keep "cmd click to launch vs code native repl" from appearing in the python (Fixed in #10713)
- Console now guarantees right click on output shows right click options for a notebook cell (Fixed in #10518)
- Console now guarantees unwanted `cmd click to launch vs code native repl` in python  startup (Fixed in #8507)

### Resource visibility

- Console now guarantees /supervisor: support extension environment contributions api (Fixed in #6985)
- Console now guarantees : code run from a script should be run in a  session, not a notebook session (Fixed in #9761)
- Console now guarantees [bug] positron  fails to inherit path "user variables" on windows (Fixed in #7274)
- Console now guarantees cannot start r or python sessions: httperror http request failed (Fixed in #9215)
- Console now guarantees crash shortly after a windows reload (Fixed in #10798)
- Console now guarantees ctrl+enter fails to execute r code with dplyr pipe and multi-line code blocks (Fixed in #10376)
- Console now guarantees leaked disposables: dropdownwithprimaryactionviewitem (Fixed in #7776)
- Console now guarantees multisession : cannot restart session after force-quit (Fixed in #6881)
- Console now guarantees multisession: changing browser can result in disconnected or lost sessions (Fixed in #7096)
- Console now guarantees r  not loading .rprofile on startup (Fixed in #9211)

### Workspace context

- Console now guarantees cannot start r or python sessions: httperror http request failed (Fixed in #9215)
- Console now guarantees copying text from  with context menu adds `nbsp` instead of spaces (Fixed in #10058)
- Console now guarantees crash shortly after a windows reload (Fixed in #10798)
- Console now guarantees crash when interrupting after immediately submitting command (Fixed in #9467)
- Console now guarantees ctrl+enter fails to execute r code with dplyr pipe and multi-line code blocks (Fixed in #10376)
- Console now guarantees ctrl+enter on code in an unsaved r file doesn't execute anymore (daily, 2026.02.0-104) (Fixed in #11533)
- Console now guarantees right click on output shows right click options for a notebook cell (Fixed in #10518)
- Console now guarantees running python module imports from subdirectories interactively (Fixed in #10045)
- Console now guarantees session can error and be corrupted when re-connecting in workbench/web (Fixed in #9407)
- Console now guarantees wrong json typing for .fontligatures (Fixed in #10593)

### Performance

- Console now guarantees /supervisor: support extension environment contributions api (Fixed in #6985)
- Console now guarantees allow the  font to be independently configured (Fixed in #8443)
- Console now guarantees can't close  that has failed to start (Fixed in #8303)
- Console now guarantees can't interrupt selection/activity prompts on windows (Fixed in #10158)
- Console now guarantees change feature flag for multisession  to default on (Fixed in #6887)
- Console now guarantees ctrl+r and cmd+up are not aware of independent  history for debugging (Fixed in #11402)
- Console now guarantees multisession: changing browser can result in disconnected or lost sessions (Fixed in #7096)
- Console now guarantees multisessions: new session created when user clicks on disconnected session (Fixed in #7005)
- Console now guarantees relax or remove active session limit (Fixed in #9576)
- Console now guarantees remove multi  session feature flag (Fixed in #7332)

## B3 — Clustering of Historical Fixes

### Focus fixes

**Total Fixed:** 12

**Sample Issues:**
- #10593: Wrong JSON typing for console.fontLigatures
- #10376: Ctrl+Enter Fails to Execute R Code with dplyr Pipe and Multi-line Code Blocks
- #10058: Copying text from console with context menu adds `nbsp` instead of spaces
- #9761: Console: Code run from a script should be run in a console session, not a notebook session
- #7522: Creating a Console doesn't raise or focus the Console tab
- #6881: multisession console: cannot restart session after force-quit
- #6845: console: input prompt truncated on startup
- #6585: The Console shows a text cursor when it shouldn't
- #6451: Console Multisessions: Keyboard Accessibility / Mouse Control Issues
- #6347: E2E Test: Console session tab list
- *...and 2 more*

**Note:** 25 similar open issues still exist

---

### Startup reliability fixes

**Total Fixed:** 54

**Sample Issues:**
- #11533: Ctrl+Enter on code in an unsaved R file doesn't execute anymore (daily, 2026.02.0-104)
- #10798: Console crash shortly after a windows reload
- #10713: Keep "Cmd click to launch VS Code Native REPL" from appearing in the Python console
- #10518: Right click on output shows right click options for a notebook cell
- #10376: Ctrl+Enter Fails to Execute R Code with dplyr Pipe and Multi-line Code Blocks
- #10158: Can't interrupt selection/activity prompts on Windows
- #10058: Copying text from console with context menu adds `nbsp` instead of spaces
- #9576: Relax or remove active session limit
- #9467: Crash when interrupting after immediately submitting command
- #9407: Session can error and be corrupted when re-connecting in Workbench/web
- *...and 44 more*

**Note:** 46 similar open issues still exist

---

### Rendering fixes

**Total Fixed:** 59

**Sample Issues:**
- #11533: Ctrl+Enter on code in an unsaved R file doesn't execute anymore (daily, 2026.02.0-104)
- #11402: Ctrl+R and Cmd+Up are not aware of independent console history for debugging
- #10798: Console crash shortly after a windows reload
- #10713: Keep "Cmd click to launch VS Code Native REPL" from appearing in the Python console
- #10593: Wrong JSON typing for console.fontLigatures
- #10518: Right click on output shows right click options for a notebook cell
- #10446: Fix and Explain console actions are missing on Windows
- #10382: Python DataFrame display in console adds a lot of extra space
- #10376: Ctrl+Enter Fails to Execute R Code with dplyr Pipe and Multi-line Code Blocks
- #10158: Can't interrupt selection/activity prompts on Windows
- *...and 49 more*

**Note:** 71 similar open issues still exist

---

### Runtime integration fixes

**Total Fixed:** 89

**Sample Issues:**
- #11533: Ctrl+Enter on code in an unsaved R file doesn't execute anymore (daily, 2026.02.0-104)
- #11402: Ctrl+R and Cmd+Up are not aware of independent console history for debugging
- #10798: Console crash shortly after a windows reload
- #10593: Wrong JSON typing for console.fontLigatures
- #10518: Right click on output shows right click options for a notebook cell
- #10382: Python DataFrame display in console adds a lot of extra space
- #10376: Ctrl+Enter Fails to Execute R Code with dplyr Pipe and Multi-line Code Blocks
- #10158: Can't interrupt selection/activity prompts on Windows
- #10058: Copying text from console with context menu adds `nbsp` instead of spaces
- #10045: Running Python module imports from subdirectories interactively
- *...and 79 more*

**Note:** 77 similar open issues still exist

---

### Interaction behavior fixes

**Total Fixed:** 31

**Sample Issues:**
- #11402: Ctrl+R and Cmd+Up are not aware of independent console history for debugging
- #10713: Keep "Cmd click to launch VS Code Native REPL" from appearing in the Python console
- #10518: Right click on output shows right click options for a notebook cell
- #10376: Ctrl+Enter Fails to Execute R Code with dplyr Pipe and Multi-line Code Blocks
- #10158: Can't interrupt selection/activity prompts on Windows
- #10058: Copying text from console with context menu adds `nbsp` instead of spaces
- #9761: Console: Code run from a script should be run in a console session, not a notebook session
- #9467: Crash when interrupting after immediately submitting command
- #9215: Cannot start R or Python sessions: HttpError HTTP request failed
- #8507: Unwanted `Cmd click to launch VS Code Native REPL` in Python Console startup
- *...and 21 more*

**Note:** 40 similar open issues still exist

---

### Performance improvements

**Total Fixed:** 24

**Sample Issues:**
- #11402: Ctrl+R and Cmd+Up are not aware of independent console history for debugging
- #10158: Can't interrupt selection/activity prompts on Windows
- #9576: Relax or remove active session limit
- #8443: Allow the console font to be independently configured
- #8303: Can't close console that has failed to start
- #7332: Remove Multi Console Session Feature Flag
- #7096: Multisession: changing browser can result in disconnected or lost sessions
- #7005: Console Multisessions: new session created when user clicks on disconnected session
- #6985: Console/Supervisor: Support Extension Environment Contributions API
- #6887: Change feature flag for multisession console to default on
- *...and 14 more*

**Note:** 17 similar open issues still exist

---

## B4 — Statistical Analysis (Closed Issues Only)

**Total Closed Console Issues:** 100

### Distribution by Type

- Bug: 81 (81.0%)
- Enhancement: 17 (17.0%)
- Performance: 2 (2.0%)

### Most Common Resolved Themes

| Rank | Theme | Count |
|------|-------|-------|
| 1 | Session/runtime integration | 89 |
| 2 | Output correctness | 59 |
| 3 | Startup reliability | 54 |
| 4 | Workspace context | 37 |
| 5 | Interaction behaviors | 31 |
| 6 | Performance | 24 |
| 7 | Resource visibility | 20 |
| 8 | Focus + input targeting | 12 |
| 9 | Other | 6 |

### Platform/Runtime Breakdown

**By Runtime:**
- R: 52 fixes
- Python: 36 fixes

## B5 — Lessons Learned From Closed Issues

### Fragile Console Subsystems

Based on the frequency of fixes, these subsystems show recurring fragility:

- **Session/runtime integration**: 89 fixes (89.0% of all closed issues)
  - Shows challenges in maintaining stable runtime connections
- **Output correctness**: 59 fixes (59.0% of all closed issues)
  - Suggests rendering and formatting edge cases are common
- **Startup reliability**: 54 fixes (54.0% of all closed issues)
- **Workspace context**: 37 fixes (37.0% of all closed issues)
- **Interaction behaviors**: 31 fixes (31.0% of all closed issues)

### Common UX Traps

Patterns from resolved issues reveal these recurring UX challenges:

1. **State synchronization**: Console state often gets out of sync with runtime state
2. **Focus management**: Complex focus rules across multiple panes cause confusion
3. **Timing issues**: Race conditions during startup and runtime transitions
4. **Platform differences**: Behavior varies significantly across OS platforms

### Areas Where Regressions Frequently Occur

- **Session/runtime integration**: 89 fixed, 77 still open → suggests regression-prone area
- **Output correctness**: 59 fixed, 71 still open → suggests regression-prone area
- **Startup reliability**: 54 fixed, 46 still open → suggests regression-prone area
- **Workspace context**: 37 fixed, 38 still open → suggests regression-prone area
- **Interaction behaviors**: 31 fixed, 40 still open → suggests regression-prone area

### Testing Improvements Implied by History

Historical patterns suggest these testing gaps:

1. **Cross-platform testing**: Many fixes are platform-specific
2. **Runtime switching**: Need automated tests for interpreter transitions
3. **Concurrent operations**: Tests for rapid state changes and async operations
4. **Focus behavior**: Comprehensive keyboard and focus flow testing
5. **Edge cases**: More coverage of unusual configurations and sequences


# FINAL SECTION — OPEN vs CLOSED GAP ANALYSIS

## C1 — Theme Comparison

### Open vs Closed Theme Frequency

| Theme | Open Count | Closed Count | Trend |
|-------|------------|--------------|-------|
| Focus + input targeting | 25 | 12 | ↑ Persistent |
| Interaction behaviors | 40 | 31 | ↑ Persistent |
| Other | 2 | 6 | → Stable |
| Output correctness | 71 | 59 | ↑ Persistent |
| Performance | 17 | 24 | ↑ Persistent |
| Resource visibility | 20 | 20 | ↑ Persistent |
| Session/runtime integration | 77 | 89 | ↑ Persistent |
| Startup reliability | 46 | 54 | ↑ Persistent |
| Workspace context | 38 | 37 | ↑ Persistent |

### Analysis

**Persistent Problem Categories:**
- Focus + input targeting: 25 open vs 12 closed - indicates ongoing challenges
- Interaction behaviors: 40 open vs 31 closed - indicates ongoing challenges
- Output correctness: 71 open vs 59 closed - indicates ongoing challenges
- Performance: 17 open vs 24 closed - indicates ongoing challenges
- Resource visibility: 20 open vs 20 closed - indicates ongoing challenges
- Session/runtime integration: 77 open vs 89 closed - indicates ongoing challenges
- Startup reliability: 46 open vs 54 closed - indicates ongoing challenges
- Workspace context: 38 open vs 37 closed - indicates ongoing challenges

## C2 — Console Maturity Assessment

### Stable Areas (Mostly Resolved)

*No themes show clear maturity yet*

### Volatile Areas (Recurring Regressions)

- **Focus + input targeting**: 12 historical fixes but 25 still open → regression-prone
- **Interaction behaviors**: 31 historical fixes but 40 still open → regression-prone
- **Output correctness**: 59 historical fixes but 71 still open → regression-prone
- **Performance**: 24 historical fixes but 17 still open → regression-prone
- **Resource visibility**: 20 historical fixes but 20 still open → regression-prone
- **Session/runtime integration**: 89 historical fixes but 77 still open → regression-prone
- **Startup reliability**: 54 historical fixes but 46 still open → regression-prone
- **Workspace context**: 37 historical fixes but 38 still open → regression-prone

### Emerging Requirement Areas (New Enhancements)

*No clear emerging areas*

## C3 — Prioritized Next Console Requirements

Based on open issue severity, frequency, and historical recurrence patterns:

### Priority 1: Session/runtime integration

**Urgency Score:** 1653.3

**Evidence:**
- 77 open issues (3 critical, 12 high severity)
- 89 historical fixes (suggests recurrence risk)

**Top Issues to Address:**
- #10582 (Low): Console can get stuck "Starting..." forever if extension host does not start
- #8282 (Low): Console duplicates executions and lacks busy indicator during background tasks
- #5115 (Low): Feature request: add more JSON prompts in the workbench settings to allow distinguishing of sent and received code and output
- #11627 (Medium): Text is added on the R console output
- #11478 (Medium): Console: Mechanism to select start folder in multi-root workspace

**Recommended Engineering Focus:**
- Stabilize runtime connection management
- Add session state recovery mechanisms
- Improve Conda environment handling

---

### Priority 2: Output correctness

**Urgency Score:** 1007.4

**Evidence:**
- 71 open issues (2 critical, 11 high severity)
- 59 historical fixes (suggests recurrence risk)

**Top Issues to Address:**
- #10582 (Low): Console can get stuck "Starting..." forever if extension host does not start
- #8282 (Low): Console duplicates executions and lacks busy indicator during background tasks
- #5115 (Low): Feature request: add more JSON prompts in the workbench settings to allow distinguishing of sent and received code and output
- #11627 (Medium): Text is added on the R console output
- #11519 (Medium): Plots are only rendered at the end of a loop

**Recommended Engineering Focus:**
- Strengthen output rendering pipeline
- Add ANSI parsing tests across platforms
- Improve error handling in display logic

---

### Priority 3: Startup reliability

**Urgency Score:** 742.4

**Evidence:**
- 46 open issues (3 critical, 8 high severity)
- 54 historical fixes (suggests recurrence risk)

**Top Issues to Address:**
- #10582 (Low): Console can get stuck "Starting..." forever if extension host does not start
- #5115 (Low): Feature request: add more JSON prompts in the workbench settings to allow distinguishing of sent and received code and output
- #11627 (Medium): Text is added on the R console output
- #11478 (Medium): Console: Mechanism to select start folder in multi-root workspace
- #11230 (Medium): Startup of console hangs the first time starting positron after upgrade

**Recommended Engineering Focus:**
- Improve runtime initialization reliability
- Add startup diagnostics and error reporting
- Test cold-start scenarios systematically

---

### Priority 4: Workspace context

**Urgency Score:** 437.1

**Evidence:**
- 38 open issues (3 critical, 5 high severity)
- 37 historical fixes (suggests recurrence risk)

**Top Issues to Address:**
- #5115 (Low): Feature request: add more JSON prompts in the workbench settings to allow distinguishing of sent and received code and output
- #11627 (Medium): Text is added on the R console output
- #11478 (Medium): Console: Mechanism to select start folder in multi-root workspace
- #11230 (Medium): Startup of console hangs the first time starting positron after upgrade
- #11221 (Medium): Windows conda consoles not working

**Recommended Engineering Focus:**
- Address high-severity bugs first
- Add comprehensive test coverage
- Improve error diagnostics

---

### Priority 5: Interaction behaviors

**Urgency Score:** 328.0

**Evidence:**
- 40 open issues (0 critical, 8 high severity)
- 31 historical fixes (suggests recurrence risk)

**Top Issues to Address:**
- #5115 (Low): Feature request: add more JSON prompts in the workbench settings to allow distinguishing of sent and received code and output
- #11627 (Medium): Text is added on the R console output
- #11478 (Medium): Console: Mechanism to select start folder in multi-root workspace
- #11411 (Medium): console: double-clicking text should select it, not jump to the bottom
- #10972 (Medium): LSP in the console: let language servers statically analyze console history

**Recommended Engineering Focus:**
- Audit UI event handler consistency
- Improve scroll and history management
- Add interaction behavior tests

---

### Priority 6: Performance

**Urgency Score:** 142.8

**Evidence:**
- 17 open issues (1 critical, 3 high severity)
- 24 historical fixes (suggests recurrence risk)

**Top Issues to Address:**
- #10582 (Low): Console can get stuck "Starting..." forever if extension host does not start
- #11478 (Medium): Console: Mechanism to select start folder in multi-root workspace
- #11230 (Medium): Startup of console hangs the first time starting positron after upgrade
- #11031 (Medium): Show indicator on Positron consoles that need to be restarted to apply changes
- #10411 (Medium): Console: Poor/no feedback when kernel is unreachable

**Recommended Engineering Focus:**
- Address high-severity bugs first
- Add comprehensive test coverage
- Improve error diagnostics

---

### Priority 7: Focus + input targeting

**Urgency Score:** 99.0

**Evidence:**
- 25 open issues (0 critical, 4 high severity)
- 12 historical fixes (suggests recurrence risk)

**Top Issues to Address:**
- #11157 (Medium): No completions in new, experimental notebook consoles
- #10972 (Medium): LSP in the console: let language servers statically analyze console history
- #10929 (Medium): Console: Return of the Dancing Consoles (flipping between R/Python at boot)
- #10411 (Medium): Console: Poor/no feedback when kernel is unreachable
- #9530 (Medium): Output from later/promises doesn't get matched to correct console input

**Recommended Engineering Focus:**
- Audit focus management logic across panes
- Implement comprehensive keyboard event testing
- Add focus state debugging tools

---

### Priority 8: Resource visibility

**Urgency Score:** 90.0

**Evidence:**
- 20 open issues (0 critical, 2 high severity)
- 20 historical fixes (suggests recurrence risk)

**Top Issues to Address:**
- #11519 (Medium): Plots are only rendered at the end of a loop
- #11458 (Medium): Console: Resource usage not visible when there is only one session
- #11221 (Medium): Windows conda consoles not working
- #11031 (Medium): Show indicator on Positron consoles that need to be restarted to apply changes
- #10972 (Medium): LSP in the console: let language servers statically analyze console history

**Recommended Engineering Focus:**
- Address high-severity bugs first
- Add comprehensive test coverage
- Improve error diagnostics

---

### Priority 9: Other

**Urgency Score:** 3.2

**Evidence:**
- 2 open issues (0 critical, 0 high severity)
- 6 historical fixes (suggests recurrence risk)

**Top Issues to Address:**
- #10849 (Low): Provide customizable notification for long running execution in the console
- #10709 (Medium): Epic: Notebook Console improvements and issues

**Recommended Engineering Focus:**
- Address high-severity bugs first
- Add comprehensive test coverage
- Improve error diagnostics

---

## Summary

**Key Findings:**

1. **Scale**: 100 open issues vs 100 resolved
2. **Top Open Priority**: Session/runtime integration (77 issues)
3. **Most Volatile Area**: Focus + input targeting
4. **Maturity**: 0 stable areas, 8 volatile areas

This analysis is grounded in GitHub issue evidence and provides actionable
engineering priorities based on user impact and historical patterns.
