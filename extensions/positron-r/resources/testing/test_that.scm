(call
	function: [
		(identifier) @_function.name
	] (#eq? @_function.name "test_that")
	arguments: (arguments
		(argument
			 value: (string) @label
		)
	)
) @call
