function enabled(value: unknown): boolean {
  return value === true || value === "true";
}

/** Self-hosted instances must explicitly opt in before AI work is claimed or executed. */
export function isAgentMatchEnabled(env: CloudflareBindings): boolean {
  return "AGENT_MATCH_ENABLED" in env && enabled(env.AGENT_MATCH_ENABLED);
}

/** Usage is stored locally; publishing it to tokens.ci requires a separate opt-in. */
export function isTokensReportEnabled(env: CloudflareBindings): boolean {
  return "TOKENS_REPORT_ENABLED" in env && enabled(env.TOKENS_REPORT_ENABLED);
}
