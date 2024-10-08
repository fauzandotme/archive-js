const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

class ArchiveError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ArchiveError';
    this.code = code;
  }
}

class Archive extends EventEmitter {
  constructor() {
    super();
    this.spawnID = null;
  }

  async compress({
    items,
    output,
    format = 'zip',
    level = 0,
    customStructure = null,
    password = null
  }) {
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new ArchiveError('Invalid or empty items array', 'INVALID_ITEMS');
    }
    if (!output) {
      throw new ArchiveError('Output path is required', 'MISSING_OUTPUT');
    }

    let command, args;
    let tempDir;
    const absoluteOutput = path.resolve(output);

    try {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-'));
      const filesToCompress = await this._prepareFiles(items, tempDir, customStructure);

      switch (format.toLowerCase()) {
        case 'rar':
          command = 'rar';
          args = ['a', `-m${level}`];
          if (password) {
            args.push(`-p${password}`);
          }
          args.push(absoluteOutput, ...filesToCompress);
          break;
        case 'zip':
        case '7z':
          command = '7z';
          args = ['a', `-t${format}`, `-mx=${level}`, '-y', '-bsp1'];
          if (password) {
            args.push(`-p${password}`);
          }
          args.push(absoluteOutput, '.');
          break;
        default:
          throw new ArchiveError(`Unsupported archive format: ${format}`, 'UNSUPPORTED_FORMAT');
      }

      await this._executeCommand(command, args, tempDir);
      return {
        fileName: path.basename(absoluteOutput),
        fullPath: absoluteOutput
      };
    } catch (error) {
      if (error instanceof ArchiveError) {
        throw error;
      }
      throw new ArchiveError(`Compression failed: ${error.message}`, 'COMPRESSION_FAILED');
    } finally {
      if (tempDir) {
        await this._removeTempDir(tempDir).catch(console.error);
      }
    }
  }

  async extract({ archiveFile, outputDir, password = null, selectedFiles = null }) {
    if (!archiveFile) {
      throw new ArchiveError('Archive file path is required', 'MISSING_ARCHIVE_FILE');
    }
    if (!outputDir) {
      throw new ArchiveError('Output directory is required', 'MISSING_OUTPUT_DIR');
    }

    try {
      await fs.access(archiveFile);
    } catch (error) {
      throw new ArchiveError(`Archive file not found: ${archiveFile}`, 'ARCHIVE_NOT_FOUND');
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-extract-'));

    try {
      await this._extractToTemp(archiveFile, tempDir, password, selectedFiles);
      const extractedFiles = await this._getFileStructure(tempDir);
      await this._moveFiles(tempDir, outputDir);

      return {
        success: true,
        message: 'Extraction completed successfully',
        files: extractedFiles
      };
    } catch (error) {
      throw error; // This will be caught by the .catch() in the user's code
    } finally {
      await this._removeTempDir(tempDir).catch(console.error);
    }
  }

  async list({ archiveFile, password = null }) {
    if (!archiveFile) {
      throw new ArchiveError('Archive file path is required', 'MISSING_ARCHIVE_FILE');
    }

    try {
      await fs.access(archiveFile);
    } catch (error) {
      throw new ArchiveError(`Archive file not found: ${archiveFile}`, 'ARCHIVE_NOT_FOUND');
    }

    let command, args;
    const ext = path.extname(archiveFile).toLowerCase();

    switch (ext) {
      case '.zip':
      case '.rar':
      case '.7z':
        command = '7z';
        args = ['l', '-ba', '-slt'];
        if (password) {
          args.push(`-p${password}`);
        }
        args.push(archiveFile);
        break;
      default:
        throw new ArchiveError(`Unsupported archive format: ${ext}`, 'UNSUPPORTED_FORMAT');
    }

    try {
      const output = await this._executeCommand(command, args);
      return this._parseListOutput(output, ext);
    } catch (error) {
      throw new ArchiveError(`Listing failed: ${error.message}`, 'LISTING_FAILED');
    }
  }

  async _prepareFiles(items, tempDir, customStructure) {
    const filesToCompress = [];
    for (const item of items) {
      try {
        const itemName = path.basename(item);
        const newPath = customStructure
          ? path.join(tempDir, customStructure, itemName)
          : path.join(tempDir, itemName);
        
        await fs.mkdir(path.dirname(newPath), { recursive: true });
        await this._copyItem(item, newPath);
        
        filesToCompress.push(customStructure ? path.join(customStructure, itemName) : itemName);
      } catch (error) {
        throw new ArchiveError(`Failed to prepare file ${item}: ${error.message}`, 'FILE_PREPARATION_FAILED');
      }
    }
    return filesToCompress;
  }

  async _copyItem(src, dest) {
    try {
      const stats = await fs.stat(src);
      if (stats.isDirectory()) {
        await this._copyDir(src, dest);
      } else {
        await fs.copyFile(src, dest);
      }
    } catch (error) {
      throw new ArchiveError(`Failed to copy item ${src}: ${error.message}`, 'COPY_FAILED');
    }
  }

  async _copyDir(src, dest) {
    try {
      await fs.mkdir(dest, { recursive: true });
      const entries = await fs.readdir(src, { withFileTypes: true });

      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          await this._copyDir(srcPath, destPath);
        } else {
          await fs.copyFile(srcPath, destPath);
        }
      }
    } catch (error) {
      throw new ArchiveError(`Failed to copy directory ${src}: ${error.message}`, 'COPY_DIR_FAILED');
    }
  }

  async _extractToTemp(archiveFile, tempDir, password, selectedFiles = null) {
    const command = '7z';
    let args = ['x', archiveFile, `-o${tempDir}`, '-y', '-bsp1'];
    
    if (password) {
      args.push(`-p${password}`);
    }
  
    if (selectedFiles && selectedFiles.length > 0) {
      args.push(...selectedFiles);
    }
  
    return new Promise((resolve, reject) => {
      const process = spawn(command, args);
      
      let stdoutData = '';
      let stderrData = '';
  
      process.stdout.on('data', (data) => {
        const message = data.toString().trim();
        stdoutData += message + '\n';
        this._parseProgress(message);
      });
  
      process.stderr.on('data', (data) => {
        const message = data.toString().trim();
        stderrData += message + '\n';
        this._parseProgress(message);
      });
  
      process.on('error', (err) => {
        reject(new ArchiveError(`Command execution failed: ${err.message}`, 'COMMAND_EXECUTION_FAILED'));
      });
  
      process.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          let errorCode = 'PROCESS_EXIT_ERROR';
          let errorMessage = `Process exited with code ${code}`;
          
          if (stderrData.includes('Wrong password') || stdoutData.includes('Wrong password')) {
            errorCode = 'INCORRECT_PASSWORD';
            errorMessage = 'Incorrect password provided';
          } else if (stderrData.trim() !== '') {
            errorMessage += `\nError output: ${stderrData.trim()}`;
          }
          
          reject(new ArchiveError(errorMessage, errorCode));
        }
      });
    });
  }

  async _getFileStructure(dir, base = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const result = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(base, entry.name);

      const isDirectory = entry.isDirectory();
      const stats = isDirectory ? null : await fs.stat(fullPath);

      const fileInfo = {
        name: entry.name,
        path: relativePath,
        size: isDirectory ? 0 : stats.size,
        isDirectory: isDirectory
      };

      if (isDirectory) {
        fileInfo.children = await this._getFileStructure(fullPath, relativePath);
      }

      result.push(fileInfo);
    }

    return result;
  }

  async _moveFiles(sourceDir, targetDir) {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);

      if (entry.isDirectory()) {
        await fs.mkdir(targetPath, { recursive: true });
        await this._moveFiles(sourcePath, targetPath);
      } else {
        await fs.rename(sourcePath, targetPath);
      }
    }
  }

  async _removeTempDir(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await this._removeTempDir(fullPath);
        } else {
          await fs.unlink(fullPath);
        }
      }
      await fs.rmdir(dir);
    } catch (error) {
      console.error(`Failed to remove temporary directory ${dir}: ${error.message}`);
    }
  }

  _executeCommand(command, args, cwd = null) {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args, { cwd });
      this.spawnID = process.pid;

      let output = '';
      let errorOutput = '';

      process.stdout.on('data', (data) => {
        const message = data.toString().trim();
        output += message + '\n';
        this._parseProgress(message);
      });

      process.stderr.on('data', (data) => {
        const message = data.toString().trim();
        errorOutput += message + '\n';
        this._parseProgress(message);
      });

      process.on('error', (err) => {
        reject(new ArchiveError(`Command execution failed: ${err.message}`, 'COMMAND_EXECUTION_FAILED'));
      });

      process.on('exit', (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          let errorCode = 'PROCESS_EXIT_ERROR';
          let errorMessage = `Process exited with code ${code}\n${errorOutput}`;
          
          if (errorOutput.includes('Wrong password')) {
            errorCode = 'INCORRECT_PASSWORD';
            errorMessage = 'Incorrect password provided';
          }
          
          reject(new ArchiveError(errorMessage, errorCode));
        }
      });
    });
  }

  _parseProgress(message) {
    const progressMatch = message.match(/(\d+)%/);
    if (progressMatch) {
      const progress = parseInt(progressMatch[1], 10);
      this.emit('progress', { percent: progress });
    }
  }

  _parseListOutput(output, format) {
    const entries = output.split('\n\n');
    const files = [];
    let isProtected = false;

    entries.forEach(entry => {
      const lines = entry.trim().split('\n');
      const fileObj = {};

      lines.forEach(line => {
        const [key, ...valueParts] = line.split('=').map(part => part.trim());
        const value = valueParts.join('=').trim();
        if (key && value !== undefined) {
          fileObj[key] = value;
        }
      });

      if (Object.keys(fileObj).length > 0 && fileObj.Path) {
        files.push(fileObj);
        // Check if any file is encrypted
        if (fileObj.Encrypted === '+') {
          isProtected = true;
        }
      }
    });

    function buildHierarchy(files) {
      const root = { name: '', isDirectory: true, children: {} };

      files.forEach(file => {
        const parts = file.Path.split('/');
        let current = root;

        parts.forEach((part, index) => {
          if (!current.children[part]) {
            current.children[part] = {
              name: part,
              isDirectory: index < parts.length - 1 || file.Folder === '+' || file.Attributes?.startsWith('D'),
              children: {},
              ...file
            };
          }
          current = current.children[part];
        });
      });

      function convertToArray(node) {
        const result = { ...node };
        if (node.isDirectory) {
          result.children = Object.values(node.children)
            .map(convertToArray)
            .sort((a, b) => {
              if (a.isDirectory === b.isDirectory) {
                return a.name.localeCompare(b.name);
              }
              return a.isDirectory ? -1 : 1;
            });
        } else {
          delete result.children;
        }
        delete result.Path;
        return result;
      }

      return Object.values(root.children).map(convertToArray);
    }

    const hierarchy = buildHierarchy(files);

    return {
      files: hierarchy,
      totalFiles: files.length,
      totalSize: files.reduce((sum, file) => sum + parseInt(file.Size || '0', 10), 0),
      isProtected: isProtected
    };
  }

  stop() {
    if (this.spawnID) {
      try {
        process.kill(this.spawnID);
        this.spawnID = null;
        this.emit('stopped', 'Archive operation stopped');
      } catch (e) {
        this.emit('error', new ArchiveError(`Error stopping archive process: ${e.message}`, 'STOP_PROCESS_FAILED'));
      }
    }
  }
}

module.exports = { Archive, ArchiveError };