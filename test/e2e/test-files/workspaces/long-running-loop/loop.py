import time

loop_number = 0
duration_seconds = 180
start_time = time.time()

print(f"Starting loop for {duration_seconds} seconds...")

while True:
    current_time = time.time()
    elapsed_time = current_time - start_time

    if elapsed_time >= duration_seconds:
        print(f"Completed {loop_number} iterations over {duration_seconds} seconds, exiting.")
        break
    
    print(f"Loop: {loop_number}")
    loop_number += 1
    time.sleep(1)  # Sleep for 1 second
