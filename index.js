#! /usr/bin/env node
const { resolve } = require('path');
const program = require('commander');
const { fixElectron, findProjectContext } = require('./bin/core');

program
  .command('start')
  .alias('s')
  .description('fix electron')
  .action(() => {
    const cwd = process.cwd();
    const context = findProjectContext(cwd);
    if (!context) {
      console.error('Error: No package.json with electron dependency found. Run from project directory or ensure electron is in dependencies.');
      process.exit(1);
    }
    const data = Object.assign({}, context.pkg, { PWD: context.pwd });
    fixElectron(data);
  });

program.parse(process.argv);