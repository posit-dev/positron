test_that("a test that can be cancelled", {
  # The e2e creates a CANCEL file to trigger this extended period of a sleepy
  # heartbeat.
  #
  # If we successfully interrupt the test run, the heartbeat stops and the
  # COMPLETED file does not get written.
  #
  # A graceful interrupt (SIGINT, POSIX case) runs on.exit() and the ON.EXIT
  # file is written.
  #
  # On Windows, we have to force-kill and ON.EXIT is not created.
  if (file.exists("CANCEL")) {
    on.exit(file.create("ON.EXIT"))
    for (i in seq_len(600)) {
      cat(".", file = "HEARTBEAT", append = TRUE)
      Sys.sleep(0.1)
    }
    file.create("COMPLETED")
  }
  expect_true(TRUE)
})
