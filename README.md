# Archive-JS

Archive-JS is a Node.js library for compressing, extracting, and listing the contents of various archive formats (ZIP, RAR, 7z). It provides a simple and consistent interface for working with these formats, handling password protection, and managing file structures within archives.

## Features

- Compress files and directories into ZIP, RAR, or 7z formats (automatically detected from output file extension)
- Extract files from ZIP, RAR, or 7z archives
- List contents of archives
- Password protection support
- Custom file structure support when compressing
- Progress tracking during operations
- Error handling with custom ArchiveError class

## Requirements

To use Archive-JS, you need to have the following command-line tools installed:

- 7-Zip (for ZIP and 7z support)
- RAR (for RAR support)

### Installing Requirements

#### 7-Zip

- **Windows**: Download and install from [7-zip.org](https://www.7-zip.org/)
- **macOS**: Install using Homebrew: `brew install p7zip`
- **Linux**: Install using your package manager:
  - Ubuntu/Debian: `sudo apt-get install p7zip-full`
  - Fedora: `sudo dnf install p7zip p7zip-plugins`

#### RAR

- **Windows**: Download and install from [win-rar.com](https://www.win-rar.com/)
- **macOS**: Install using Homebrew: `brew install rar`
- **Linux**: Install using your package manager:
  - Ubuntu/Debian: `sudo apt-get install rar`
  - Fedora: `sudo dnf install rar`

## Installation

Install Archive-JS using npm:

```bash
npm i @fauzandotme/archive-js
```

## Usage

Here are some examples of how to use Archive-JS:

### Compressing Files

```javascript
const { Archive } = require('@fauzandotme/archive-js');

const archive = new Archive();

archive.compress({
  items: ['file1.txt', 'file2.txt', 'directory1'],
  output: 'output.zip', // The format is automatically detected from the file extension
  level: 5,
  password: 'secretpassword'
})
.then(result => {
  console.log('Compression completed:', result);
})
.catch(error => {
  console.error('Compression failed:', error);
});

// Track progress
archive.on('progress', (progress) => {
  console.log(`Compression progress: ${progress.percent}%`);
});
```

### Extracting Files

```javascript
const { Archive } = require('@fauzandotme/archive-js');

const archive = new Archive();

archive.extract({
  archiveFile: 'archive.zip',
  outputDir: 'extracted_files',
  password: 'secretpassword'
})
.then(result => {
  console.log('Extraction completed:', result);
})
.catch(error => {
  console.error('Extraction failed:', error);
});

// Track progress
archive.on('progress', (progress) => {
  console.log(`Extraction progress: ${progress.percent}%`);
});
```

### Listing Archive Contents

```javascript
const { Archive } = require('@fauzandotme/archive-js');

const archive = new Archive();

archive.list({
  archiveFile: 'archive.zip',
  password: 'secretpassword'
})
.then(result => {
  console.log('Archive contents:', result);
})
.catch(error => {
  console.error('Listing failed:', error);
});
```

## Error Handling

Archive-JS uses a custom `ArchiveError` class for error handling. You can catch these errors and check their `code` property for specific error types:

```javascript
const { Archive, ArchiveError } = require('@fauzandotme/archive-js');

const archive = new Archive();

archive.extract({
  archiveFile: 'archive.zip',
  outputDir: 'extracted_files'
})
.catch(error => {
  if (error instanceof ArchiveError) {
    console.error(`Archive operation failed: ${error.message} (Code: ${error.code})`);
  } else {
    console.error('Unexpected error:', error);
  }
});
```

## License

[MIT License](LICENSE)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.