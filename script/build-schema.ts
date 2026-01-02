#!/usr/bin/env bun
/**
 * Build JSON schema for wiki-generator configuration
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "OpenCode Wiki Generator Configuration",
    type: "object",
    properties: {
        output_dir: {
            type: "string",
            description: "Output directory for wiki files",
            default: "./wiki",
        },
        index_depth: {
            type: "number",
            description: "Depth of index generation",
            default: 2,
        },
        exclude_patterns: {
            type: "array",
            items: { type: "string" },
            description: "Glob patterns to exclude from analysis",
            default: ["**/node_modules/**", "**/dist/**", "**/*.test.ts"],
        },
        models: {
            type: "object",
            description: "Model configuration for different agents",
            properties: {
                orchestrator: { type: "string" },
                analyzer: { type: "string" },
                writer: { type: "string" },
                apiDocGen: { type: "string" },
                diagramGen: { type: "string" },
                translator: { type: "string" },
            },
        },
        parallelism: {
            type: "object",
            properties: {
                max_concurrent_tasks: {
                    type: "number",
                    default: 5,
                },
            },
        },
        features: {
            type: "object",
            properties: {
                api_docs: { type: "boolean", default: true },
                diagrams: { type: "boolean", default: true },
                architecture_overview: { type: "boolean", default: true },
            },
        },
    },
};

const outputPath = join(import.meta.dirname!, "..", "dist", "opencode-wiki.schema.json");

// Ensure dist directory exists
mkdirSync(dirname(outputPath), { recursive: true });

writeFileSync(outputPath, JSON.stringify(schema, null, 2));
console.log(`Schema written to ${outputPath}`);
