
# A set of examples to test the ark diagnostics.

# We should get warnings that 'apple' and 'banana' are not defined.
print(apple, banana)

# We should skip those warnings within a formula.
apple ~ banana

# We should check names in subset calls.
mtcars$cyl    # ok
mtcars$oops   # 'oops' does not exist

# We should diagnose incorrect argument names.
stats::rnorm(oops = 42)

# We should treat 'local()' as a scope-creating function.
local({
    local_variable <- 42
})
local_variable   # should warn

# Similarly for function definitions.
(function() {
    local_variable_2 <- 42
})()
local_variable_2  # should warn
