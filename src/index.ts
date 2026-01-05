/**
 * OpenCode Wiki Generator Plugin
 *
 * This plugin provides automatic wiki generation capabilities for codebases
 * using a multi-agent orchestration pattern.
 *
 * @see https://opencode.ai/docs/plugins
 */

import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

export const name = "opencode-wiki";
export const version = "0.1.0";

/**
 * OpenCode Wiki Generator Plugin
 *
 * Provides wiki generation capabilities through:
 * - Custom tools for scanning and generating documentation
 * - Event hooks for integration with OpenCode workflow
 */
export const OpenCodeWikiPlugin: Plugin = async ({
    project,
    client,
    $,
    directory,
    worktree,
}) => {
    console.log(`${name} v${version} initialized`);
    console.log(`  Project: ${project?.id ?? "unknown"}`);
    console.log(`  Directory: ${directory}`);

    return {
        // Custom tools for wiki generation
        tool: {
            /**
             * Scan codebase structure to identify modules and entry points
             */
            wiki_scan_structure: tool({
                description:
                    "Scan the codebase structure to identify modules, entry points, and file distribution. " +
                    "This helps plan the documentation generation strategy.",
                args: {
                    target_path: tool.schema
                        .string()
                        .describe(
                            "Absolute path to scan (usually project root)"
                        ),
                    max_depth: tool.schema
                        .number()
                        .optional()
                        .describe("Maximum depth to traverse (default: 3)"),
                    exclude_dirs: tool.schema
                        .array(tool.schema.string())
                        .optional()
                        .describe(
                            "Directories to ignore (e.g., node_modules, dist)"
                        ),
                },
                async execute(args, ctx) {
                    // TODO: Implement structure scanning
                    return JSON.stringify(
                        {
                            status: "not_implemented",
                            message:
                                "wiki_scan_structure tool is planned for Phase 1",
                            args,
                        },
                        null,
                        2
                    );
                },
            }),

            /**
             * Extract symbols (classes, functions, interfaces) from a source file
             */
            wiki_extract_symbols: tool({
                description:
                    "Parse a source file and extract exported symbols including classes, functions, interfaces, and their signatures.",
                args: {
                    file_path: tool.schema
                        .string()
                        .describe("Absolute path to the source file"),
                },
                async execute(args, ctx) {
                    // TODO: Implement symbol extraction
                    return JSON.stringify(
                        {
                            status: "not_implemented",
                            message:
                                "wiki_extract_symbols tool is planned for Phase 1",
                            args,
                        },
                        null,
                        2
                    );
                },
            }),

            /**
             * Initialize wiki output directory structure
             */
            wiki_init_structure: tool({
                description:
                    "Initialize the wiki output directory with standard folders (modules/, api/, architecture/, guides/) and configuration files.",
                args: {
                    output_dir: tool.schema
                        .string()
                        .describe("Target directory for the wiki"),
                    structure: tool.schema
                        .enum(["default", "flat", "hierarchical"])
                        .optional()
                        .describe("Layout style (default: 'default')"),
                },
                async execute(args, ctx) {
                    // TODO: Implement wiki structure initialization
                    return JSON.stringify(
                        {
                            status: "not_implemented",
                            message:
                                "wiki_init_structure tool is planned for Phase 2",
                            args,
                        },
                        null,
                        2
                    );
                },
            }),

            /**
             * Write a wiki page with frontmatter
             */
            wiki_write_page: tool({
                description:
                    "Write a Markdown file to the wiki directory with automatic frontmatter handling.",
                args: {
                    rel_path: tool.schema
                        .string()
                        .describe(
                            "Relative path inside wiki dir (e.g., 'modules/auth.md')"
                        ),
                    content: tool.schema
                        .string()
                        .describe("The markdown content"),
                    title: tool.schema
                        .string()
                        .describe("Page title for frontmatter"),
                    metadata: tool.schema
                        .record(tool.schema.string(), tool.schema.unknown())
                        .optional()
                        .describe(
                            "Additional frontmatter (e.g., sidebar_position)"
                        ),
                },
                async execute(args, ctx) {
                    // TODO: Implement wiki page writing
                    return JSON.stringify(
                        {
                            status: "not_implemented",
                            message:
                                "wiki_write_page tool is planned for Phase 2",
                            args,
                        },
                        null,
                        2
                    );
                },
            }),

            /**
             * Update navigation files
             */
            wiki_update_nav: tool({
                description:
                    "Update global navigation files (_sidebar.md or SUMMARY.md) for the wiki.",
                args: {
                    wiki_root: tool.schema
                        .string()
                        .describe("Absolute path to wiki root"),
                    items: tool.schema
                        .array(
                            tool.schema.object({
                                title: tool.schema.string(),
                                path: tool.schema.string(),
                                children: tool.schema
                                    .array(
                                        tool.schema.object({
                                            title: tool.schema.string(),
                                            path: tool.schema.string(),
                                        })
                                    )
                                    .optional(),
                            })
                        )
                        .describe("List of navigation items"),
                },
                async execute(args, ctx) {
                    // TODO: Implement navigation update
                    return JSON.stringify(
                        {
                            status: "not_implemented",
                            message:
                                "wiki_update_nav tool is planned for Phase 2",
                            args,
                        },
                        null,
                        2
                    );
                },
            }),

            /**
             * Validate internal links in wiki
             */
            wiki_validate_links: tool({
                description:
                    "Scan the generated wiki and validate all internal links are valid.",
                args: {
                    wiki_root: tool.schema
                        .string()
                        .describe("Absolute path to wiki root"),
                },
                async execute(args, ctx) {
                    // TODO: Implement link validation
                    return JSON.stringify(
                        {
                            status: "not_implemented",
                            message:
                                "wiki_validate_links tool is planned for Phase 2",
                            args,
                        },
                        null,
                        2
                    );
                },
            }),
        },

        // Event hooks
        event: async ({ event }) => {
            // Log session events for debugging
            if (event.type === "session.created") {
                console.log(`[${name}] New session created`);
            }
        },

        
    };
};

// Default export for convenience
export default OpenCodeWikiPlugin;
