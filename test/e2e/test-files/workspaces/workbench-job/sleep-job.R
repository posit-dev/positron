# Script for the Workbench job e2e test. It sleeps long enough for the test to
# observe the job in the Running state, then prints a marker the test looks for
# in the job output to confirm the script actually ran to completion.
sleep_seconds <- 20

cat("Workbench job started\n")
Sys.sleep(sleep_seconds)
cat(sprintf("Workbench job finished after %d seconds\n", sleep_seconds))
