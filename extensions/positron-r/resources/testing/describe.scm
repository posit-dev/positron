(call
	function: [
		(identifier) @_superfunction.name
	] (#eq? @_superfunction.name "describe")
	arguments: (arguments
		(argument
			value: (string) @superlabel
		)
		(argument
			value: (braced_expression
				body: (call
					function: [
						(identifier) @_function.name
					] (#eq? @_function.name "it")
					arguments: (arguments
						(argument
							value: (string) @label
						)
					)
				) @call
			)
		)
	)
) @supercall
