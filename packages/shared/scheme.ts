/**
 * Input: None
 * Output: URL_SCHEME
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * The app's URL scheme — the single source of truth shared by the renderer URI
 * router, the Electron main URL parser, the CLI URL short-circuit, and every
 * generated share link. It is `attention://`, NOT `obsidian://`: registering or
 * emitting the latter would drive the user's real Obsidian at the OS level.
 * The mechanism is reconstructed from Obsidian's; the scheme is our product's.
 */
export const URL_SCHEME = "attention://";
