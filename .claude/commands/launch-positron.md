# Launch the Positron IDE for development

Follow this exact sequence:

1. Check if daemons are running:
	```bash
	npm run build-ps
	```

2. If daemons are missing, start them in background:
	```bash
	npm run build-start
	```

3. Wait for daemons to finish compiling WITHOUT errors:
	```bash
	npm run build-check
	```

4. Launch Positron in the background (use run_in_background=true):
	```bash
	./scripts/code.sh
	```

5. IMMEDIATELY respond with a brief confirmation like "Positron launched in background" - do NOT wait for verification or monitor output.
