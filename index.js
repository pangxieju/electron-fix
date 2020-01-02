#! /usr/bin/env node
const program = require('commander');
const { fixElectron } = require('./bin/core');

program
  .command('start')
  .alias('s')
  .description('fix electron')
  .action(() => {
    const data = require(process.env.PWD + '/package.json')
    data.PWD = process.env.PWD;
    fixElectron(data);
  });

program.parse(process.argv);