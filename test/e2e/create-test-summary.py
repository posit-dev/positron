import os
import re

def list_files_and_extract_tests():
    tests_dir = "tests"  # Define the main directory name
    if not os.path.exists(tests_dir) or not os.path.isdir(tests_dir):
        print(f"Directory '{tests_dir}' not found.")
        return

    test_pattern = re.compile(r'test\(["\'](.+?)["\']')  # Regex to extract test descriptions
    text_extensions = {".ts"}  # Allowed file extensions
    test_count = 0  # Counter for test cases

    # Iterate over subdirectories in tests/
    for subdir in sorted(os.listdir(tests_dir)):
        subdir_path = os.path.join(tests_dir, subdir)

        # Ensure it's a directory
        if os.path.isdir(subdir_path):
            files = sorted(f for f in os.listdir(subdir_path) if os.path.isfile(os.path.join(subdir_path, f)))

            # Print header for subdirectory
            if files:
                print(subdir)

                # Process each file in the subdirectory
                for file in files:
                    file_path = os.path.join(subdir_path, file)

                    # Skip non-text files (e.g., PNG, JPG, etc.)
                    if not any(file.lower().endswith(ext) for ext in text_extensions):
                        continue

                    print(f"    {file}")  # Indented filename

                    # Read file and extract test descriptions
                    try:
                        with open(file_path, "r", encoding="utf-8") as f:
                            for line in f:
                                match = test_pattern.search(line)
                                if match:
                                    print(f"        {match.group(1)}")  # Indent test description
                                    test_count += 1  # Increment test counter
                    except UnicodeDecodeError:
                        print(f"        [Skipping: Cannot read file {file}]")  # Inform about skipped files
                print()  # Blank line for separation

    # Print total test count
    print(f"Total test cases found: {test_count}")

if __name__ == "__main__":
    list_files_and_extract_tests()
