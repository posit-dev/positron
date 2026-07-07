  # Simple function to test breakpoints
  multiply_values <- function(a, b) {
        result <- a * b
        return(result)
  }

  # Test the function with different values
  lapply(1:3, function(x) {
        y <- x * 2
        multiply_values(x, y)
  })