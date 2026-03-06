const { writeFile, accessSync, constants, createWriteStream, readFileSync, existsSync, readdirSync } = require('fs');
const { platform, arch, tmpdir } = require('os');
const { resolve, dirname, join } = require('path');
const { exec, execSync } = require('child_process');
const { createRequire } = require('module');
const axios = require('axios');
const chalk = require('chalk');
const ora = require('ora');

const ORIGIN = 'https://npmmirror.com/mirrors/electron/';
const TMPDIR = tmpdir();
const PATH_TXT = {
  'darwin': 'Electron.app/Contents/MacOS/Electron',
  'win32': 'electron.exe'
};


/**
 * fsExistsSync
 * @param  {String} filePath
 * @return {Boolean}
*/
const fsExistsSync = (filePath) => {
  try{
    accessSync(resolve(filePath), constants.F_OK);
  }catch(e){
    return false;
  }
  return true;
}


/**
 * hasElectronDependency
 * @param  {Object} pkg package.json object
 * @return {Boolean}
*/
const hasElectronDependency = (pkg) => {
  const { dependencies = {}, devDependencies = {} } = pkg;
  return !!(dependencies.electron || devDependencies.electron);
};


/**
 * expandWorkspacePattern - Expand pnpm workspace pattern (e.g. packages/*) to directories
 * @param  {String} pattern - Glob-like pattern path
 * @return {String[]} - Array of directory paths
*/
const expandWorkspacePattern = (pattern) => {
  const results = [];
  const lastStar = pattern.lastIndexOf('*');
  if (lastStar === -1) {
    if (existsSync(pattern)) results.push(resolve(pattern));
    return results;
  }
  const baseDir = dirname(pattern);
  const suffix = pattern.slice(lastStar + 1);
  if (!existsSync(baseDir)) return results;
  try {
    const entries = readdirSync(baseDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory() && !ent.name.startsWith('.')) {
        const fullPath = join(baseDir, ent.name, suffix);
        if (existsSync(join(fullPath, 'package.json'))) {
          results.push(resolve(fullPath));
        }
      }
    }
  } catch (e) {}
  return results;
};


/**
 * findProjectContext - Find package.json with electron, supports pnpm workspace
 * @param  {String} cwd - Starting directory (default: process.cwd())
 * @return {Object} { pkg, pwd, packageJsonPath }
*/
const findProjectContext = (cwd = process.cwd()) => {
  let dir = resolve(cwd);

  // Walk up to find package.json with electron
  while (dir !== dirname(dir)) {
    const packageJsonPath = join(dir, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        if (hasElectronDependency(pkg)) {
          return { pkg, pwd: dir + (dir.endsWith('/') || dir.endsWith('\\') ? '' : '/'), packageJsonPath };
        }
      } catch (e) {
        // Invalid JSON, continue
      }
    }

    // Check pnpm workspace - find workspace packages that have electron
    const workspaceYamlPath = join(dir, 'pnpm-workspace.yaml');
    if (existsSync(workspaceYamlPath)) {
      try {
        const content = readFileSync(workspaceYamlPath, 'utf-8');
        const packagesMatch = content.match(/packages:\s*([\s\S]*?)(?=\n\w|\n#|$)/);
        if (packagesMatch) {
          const packagesGlob = packagesMatch[1].trim().split('\n')
            .map(line => line.replace(/^[\s-]+/, '').trim().replace(/['"]/g, ''))
            .filter(Boolean);
          for (const pattern of packagesGlob) {
            const expanded = expandWorkspacePattern(join(dir, pattern));
            for (const pkgDir of expanded) {
              const pkgPath = join(pkgDir, 'package.json');
              if (existsSync(pkgPath)) {
                try {
                  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
                  if (hasElectronDependency(pkg)) {
                    const pwd = pkgDir + (pkgDir.endsWith('/') || pkgDir.endsWith('\\') ? '' : '/');
                    return { pkg, pwd, packageJsonPath: pkgPath };
                  }
                } catch (e) {}
              }
            }
          }
        }
      } catch (e) {}
    }

    dir = dirname(dir);
  }

  // Fallback: use cwd's package.json if it has electron
  const packageJsonPath = join(resolve(cwd), 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      if (hasElectronDependency(pkg)) {
        return { pkg, pwd: resolve(cwd) + '/', packageJsonPath };
      }
    } catch (e) {}
  }

  return null;
};


/**
 * getVersionFromCatalog - Parse electron version from pnpm-workspace.yaml catalog
 * @param  {String} workspaceRoot - Path to workspace root
 * @return {String|undefined}
*/
const getVersionFromCatalog = (workspaceRoot) => {
  const workspaceYamlPath = join(workspaceRoot, 'pnpm-workspace.yaml');
  if (!existsSync(workspaceYamlPath)) return undefined;

  try {
    const content = readFileSync(workspaceYamlPath, 'utf-8');
    const electronMatch = content.match(/\belectron:\s*['"]?([^'"\s#\n]+)['"]?/);
    if (electronMatch) {
      return electronMatch[1].replace(/^[\^~]/, '');
    }
  } catch (e) {}
  return undefined;
};


/**
 * resolveElectronPath - Get electron install path using Node's module resolution (works with pnpm)
 * @param  {String} pwd - Project directory
 * @return {String|undefined} - Path to electron package directory
*/
const resolveElectronPath = (pwd) => {
  try {
    const req = createRequire(join(pwd, 'package.json'));
    const electronPkgPath = req.resolve('electron/package.json');
    return dirname(electronPkgPath);
  } catch (e) {
    return undefined;
  }
};


/**
 * setFileName
 * @param  {Object / String} data - version symbols
 * @param  {String} pwd - Project directory
 * @return {String}
*/
const setFileName = (data, pwd) => {
  const version = getVersion(data, pwd);
  if (!data || !version) throw 'version is undefined';

  if (typeof data === 'string') return data;

  let name = [
    'electron',
    `v${version}`,
    `${platform()}`,
    `${arch()}`
  ];

  if (data.symbols) name.push('symbols');

  return name.join('-');
};


/**
 * downloadElectron
 * @param  {String} url
 * @param  {String} downloadDir
 * @return {String}
*/
const downloadElectron = async (url, downloadDir) => {
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream'
  });

  response.data.pipe(createWriteStream(downloadDir));

  return new Promise((resolve, reject) => {
    response.data.on('end', () => {
      resolve()
    })
    response.data.on('error', () => {
      reject()
    })
  })
};


/**
 * unzip
 * @param  {String} entry
 * @param  {String} output
*/
const unzip = (entry, output) => {
  if (!fsExistsSync(entry)) {
    throw 'File does not exist!';
  }

 return new Promise((resolve, reject) => {
    const command = process.platform === 'win32'
      ? `powershell -Command "Expand-Archive -Path '${entry}' -DestinationPath '${output}' -Force"`
      : `unzip -o ${entry} -d ${output}`;

    exec(command, (error) => {
      if (error) {
        console.error(`exec error: ${error}`);
        reject(error);
      } else {
        resolve();
      }
    });
  });
};


/**
 * isInstallElectron
 * @param  {Object} pkg - package.json object
 * @param  {String} electronPackagePath - Path to electron/package.json
 * @param  {String} electronPath - Resolved electron path (from resolveElectronPath, for pnpm)
 * @return {Boolean}
*/
const isInstallElectron = (pkg, electronPackagePath, electronPath) => {
  if (electronPath && fsExistsSync(join(electronPath, 'package.json'))) {
    return true;
  }
  if (pkg.PWD && !fsExistsSync(electronPackagePath)) {
    return false;
  }
  const { dependencies, devDependencies } = pkg;
  return !!(
    (dependencies && dependencies.electron) ||
    (devDependencies && devDependencies.electron)
  );
};


/**
 * getVersion
 * @param  {Object} data - package.json data
 * @param  {String} pwd - Project directory (for resolving electron in pnpm workspace)
 * @return {String} result string
*/
const getVersion = (data, pwd) => {
  const projectDir = pwd ? resolve(pwd) : process.cwd();

  // 1. Try to get version from actually installed electron (works with npm/yarn/pnpm)
  const electronPath = resolveElectronPath(projectDir);
  if (electronPath) {
    try {
      const electronPkg = JSON.parse(readFileSync(join(electronPath, 'package.json'), 'utf-8'));
      if (electronPkg.version) {
        return electronPkg.version;
      }
    } catch (e) {}
  }

  const { dependencies, devDependencies } = data || {};
  let version = dependencies?.electron || devDependencies?.electron || '';

  // 2. Handle "catalog:" format (pnpm workspace catalog)
  if (version === 'catalog:' || version.startsWith('catalog:')) {
    const workspaceRoot = findWorkspaceRoot(projectDir);
    if (workspaceRoot) {
      const catalogVersion = getVersionFromCatalog(workspaceRoot);
      if (catalogVersion) return catalogVersion;
    }

    try {
      const output = execSync('pnpm list electron --depth Infinity --json', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        cwd: projectDir
      });
      const parsed = JSON.parse(output);
      const packages = Array.isArray(parsed) ? parsed : (parsed.dependencies || [parsed]);
      for (const pkg of packages) {
        const dep = pkg?.devDependencies?.electron || pkg?.dependencies?.electron;
        if (dep?.version) return dep.version;
      }
    } catch (error) {
      // Ignore
    }

    if (version.startsWith('catalog:')) {
      return version.split(':')[1] || '';
    }
  }

  // 3. Remove version prefix characters (^/~) if present
  if (version && /^[\^~]/.test(version)) {
    return version.substring(1);
  }

  return version;
};


/**
 * findWorkspaceRoot - Find pnpm workspace root directory
 * @param  {String} startDir
 * @return {String|undefined}
*/
const findWorkspaceRoot = (startDir) => {
  let dir = resolve(startDir);
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return undefined;
};

/**
 * writeConfig
 * @param  {Object} PWD pathTxt
*/
const writeConfig = (output, data) => {
  let outData = '';

  if (data && data[platform()]) {
    outData = data[platform()];
  }
  return new Promise((resolve, reject) => {
    writeFile(output, outData, error => {
      if (error) {
        reject();
      } else {
        resolve();
      }
    });
  });
};


/**
 * fixElectron
 * @param  {Object} data
 * required:
 *   PWD[string] - Project directory
 * other:
 *   pathTxt[Object]
 *   symbols[string]
 *   origin[string]
*/
const fixElectron = (data) => {
  const pwd = data.PWD ? resolve(data.PWD) : process.cwd();
  const electronPath = resolveElectronPath(pwd) || join(pwd, 'node_modules', 'electron');
  const electronPackagePath = join(electronPath, 'package.json');
  const version = getVersion(data, pwd);
  const fileName = setFileName(data, pwd) + '.zip';

  console.log(chalk.default.bold('Electron version:', version));
  const loading = ora(chalk.yellow('Loading...')).start();

  if (isInstallElectron(data, electronPackagePath, electronPath)) {
    const downloadUrl = (data.origin || ORIGIN) + version + '/' + fileName;
    const downloadDir = resolve(data.entry || TMPDIR, fileName);

    loading.text = 'Download Electron...';

    downloadElectron(downloadUrl, downloadDir).then(() => {
      loading.succeed(chalk.green('Download Electron successful!'));

      const zipEntry = resolve(TMPDIR, fileName);
      const zipOutput = join(electronPath, 'dist');
      const configOutput = join(electronPath, 'path.txt');
      const configData = Object.assign({}, PATH_TXT, data.pathTxt || {});

      Promise.all([
        unzip(zipEntry, zipOutput).then(() => {
          loading.succeed(chalk.green('Unzip Electron successful!'));
        }),
        writeConfig(configOutput, configData).then(() => {
          loading.succeed(chalk.green('Write configuration succeeded!'));
        })
      ]).then(() => {
        loading.succeed(chalk.green('Success!'));
      });
    }).catch(error => {
      console.error(error);
    });

  } else {
    loading.fail(`You didn't install electron!`);
    console.log(
      chalk.yellow.bold(
        `Try it 'pnpm add electron -D' or 'npm install electron -D' or 'yarn add electron -D'.`
      )
    );
  }
};


module.exports = {
  setFileName,
  downloadElectron,
  isInstallElectron,
  getVersion,
  writeConfig,
  fixElectron,
  findProjectContext,
  resolveElectronPath
};
