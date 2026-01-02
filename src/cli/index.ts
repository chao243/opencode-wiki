#!/usr/bin/env bun
/**
 * OpenCode Wiki CLI
 *
 * Command line interface for the wiki generator plugin.
 */

import { Command } from "commander";

const program = new Command();

program
    .name("opencode-wiki")
    .description("Automatic wiki generation for codebases")
    .version("0.1.0");

program
    .command("generate")
    .description("Generate wiki documentation for the current codebase")
    .option("-o, --output <dir>", "Output directory for wiki files", "./wiki")
    .option("-c, --config <file>", "Configuration file path", "wiki-generator.json")
    .action(async (options) => {
        console.log("Wiki generation is not implemented yet.");
        console.log("Options:", options);
    });

program
    .command("init")
    .description("Initialize wiki configuration in the current directory")
    .action(async () => {
        console.log("Wiki initialization is not implemented yet.");
    });

program.parse();
