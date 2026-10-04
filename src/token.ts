/** Provider credentials are supplied explicitly by the operator. */
export async function getAnthropicToken(): Promise<{ token: string; headers: Record<string, string> }> {
  const token = process.env.ANTHROPIC_API_KEY?.trim();
  if (!token) throw new Error("ANTHROPIC_API_KEY must be set");
  return { token, headers: {} };
}
