#! /usr/bin/env node
const { resolve } = require('path');
const program = require('commander');
const { fixElectron } = require('./bin/core');
const data = require(resolve('./', 'package.json'));

program
  .command('start')
  .alias('s')
  .description('fix electron')
  .action(() => {
    data.PWD = './';
    fixElectron(data);
  });

program.parse(process.argv);