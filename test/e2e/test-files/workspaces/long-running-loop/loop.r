loop_number <- 0
duration_seconds <- 180
start_time <- Sys.time()

cat(sprintf("Starting loop for %d seconds...\n", duration_seconds))

while (TRUE) {
  current_time <- Sys.time()
  elapsed_time <- as.numeric(difftime(current_time, start_time, units = "secs"))

  if (elapsed_time >= duration_seconds) {
    cat(sprintf(
      "Completed %d iterations over %d seconds, exiting.\n",
      loop_number,
      duration_seconds
    ))
    break
  }

  cat(sprintf("Loop: %d\n", loop_number))
  loop_number <- loop_number + 1
  Sys.sleep(1) # Sleep for 1 second
}
