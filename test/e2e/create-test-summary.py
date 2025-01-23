import os
import re

def list_files_and_extract_tests():
    tests_dir = "tests"  # Define the main directory name
    if not os.path.exists(tests_dir) or not os.path.isdir(tests_dir):
        print(f"Directory '{tests_dir}' not found.")
        return

    test_pattern = re.compile(r'test\(["\'](.+?)["\']')  # Regex to extract test descriptions

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
                    print(f"    {file}")  # Indented filename

                    # Read file and extract test descriptions
                    with open(file_path, "r", encoding="utf-8") as f:
                        for line in f:
                            match = test_pattern.search(line)
                            if match:
                                print(f"        {match.group(1)}")  # Indent test description
                print()  # Blank line for separation

if __name__ == "__main__":
    list_files_and_extract_tests()
