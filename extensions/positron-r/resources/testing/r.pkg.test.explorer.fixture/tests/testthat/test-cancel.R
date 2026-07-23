test_that("a test that can be cancelled", {
  # The e2e writes CANCEL to trigger this sleep.
  if (file.exists("CANCEL")) {
    on.exit(file.create("ON.EXIT"))
    Sys.sleep(30)
    # If we successfully interrupt during the sleep, we never get this far.
    file.create("SLEEP COMPLETED")
  }
  expect_true(TRUE)
})
