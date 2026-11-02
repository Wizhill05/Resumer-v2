export function agentPrompt(mcpUrl: string): string {
  return `Connect to my Résumer MCP server at ${mcpUrl}, provide the sign-in link, then call check_readiness as soon as I sign in and follow its guidance.`
}
