const { writeFile, accessSync, constants, createWriteStream } = require('fs');
const { platform, arch, tmpdir } = require('os');
const { resolve } = require('path');
const { exec, execSync } = require('child_process');
const axios = require('axios');
const chalk = require('chalk');
const ora = require('ora');

const ORIGIN = 'https://npmmirror.com/mirrors/electron/';
const TMPDIR = tmpdir();
const OUTDIR = '/node_modules/electron/';
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
 * setFileName
 * @param  {Object / String} version symbols
 * @return {String}
*/
const setFileName = (data) => {
  const version = getVersion(data);
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
 * @param  {Object} package
 * @param  {String} electronPackagePath
 * @return {Boolean}
*/
const isInstallElectron = (package, electronPackagePath) => {
  if (package.PWD && !fsExistsSync(electronPackagePath)) {
    return false;
  }

  const { dependencies, devDependencies } = package;
  if (
    (dependencies && dependencies.electron) ||
    (devDependencies && devDependencies.electron)
  ) {
    return true;
  }
  return false;
};


/**
 * getVersion
 * @param  {Object} data
 * @return {String} result string
*/
const getVersion = (data) => {
  const { dependencies, devDependencies } = data;
  let version = '';

  // Extract declared version from either dependencies or devDependencies
  if (dependencies?.electron) {
    version = dependencies.electron;
  } else if (devDependencies?.electron) {
    version = devDependencies.electron;
  }

  // Handle "catalog:" format (monorepo specific)
  if (version === 'catalog:' || version.startsWith('catalog:')) {
    try {
      // Execute pnpm command to get installed Electron details
      const output = execSync('pnpm list electron --depth Infinity --json', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'] // Suppress error output
      });

      const packages = JSON.parse(output);

      // Find Electron version in dependency tree
      for (const pkg of packages) {
        if (pkg.devDependencies?.electron) {
          return pkg.devDependencies.electron.version;
        }
        if (pkg.dependencies?.electron) {
          return pkg.dependencies.electron.version;
        }
      }
    } catch (error) {
      console.warn('Failed to retrieve Electron version via pnpm:', error.message);
    }

    // Fallback to parsing catalog format if pnpm method fails
    if (version.startsWith('catalog:')) {
      return version.split(':')[1] || '';
    }
  }

  // Remove version prefix characters (^/~) if present
  if (/^[\^~]/.test(version)) {
    return version.substring(1);
  }

  return version;
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
 * @param  {Object}
 * required:
 *   PWD[string]
 *   version[string]
 * other:
 *   pathTxt[Object]
 *   symbols[string]
 *   origin[string]
*/
const fixElectron = (data) => {
  const version = getVersion(data);
  const fileName = setFileName(data) + '.zip';
  const outDir = data.PWD + OUTDIR;
  const electronPackagePath = resolve(outDir, 'package.json');

  console.log(chalk.default.bold('Electron version:', version));
  const loading = ora(chalk.yellow('Loading...')).start();

  if (isInstallElectron(data, electronPackagePath)) {
    const downloadUrl = (data.origin || ORIGIN) + version + '/' + fileName;
    const downloadDir = resolve(data.entry || TMPDIR, fileName);

    loading.text = 'Download Electron...';

    downloadElectron(downloadUrl, downloadDir).then(() => {
      loading.succeed(chalk.green('Download Electron successful!'));

      const zipEntry = resolve(TMPDIR, fileName);
      const zipOutput = resolve(outDir, 'dist');
      const configOutput = resolve(outDir, 'path.txt');
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
        `Try it 'yarn add electron' or 'npm install electron -D'.`
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
  fixElectron
};
