#!/usr/bin/env node

const { program } = require('commander');
const { startWorker } = require('../src/worker');

program
    .name('nebula-worker')
    .description('Contribute compute to the Nebula distributed AI network')
    .version('1.0.0');

program
    .command('start')
    .description('Start contributing compute to the Nebula network')
    .option('--master <url>', 'Master node URL', 'http://localhost:3000')
    .option('--model <name>', 'Ollama model to use (auto-detected if not specified)')
    .action((options) => {
        startWorker(options.master, options.model);
    });

program.parse();