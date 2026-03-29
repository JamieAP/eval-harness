const TOKEN_URL = process.env.TOKEN_API_URL ?? "https://example-token-service.example.invalid";

interface TokenResponse {
  access: string;
  provider?: string;
  slot?: string;
  expires_at?: string;
}

export async function getAnthropicToken(): Promise<{
  token: string;
  headers: Record<string, string>;
}> {
  const resp = await fetch(`${TOKEN_URL}/token/anthropic`);
  if (!resp.ok) throw new Error(`token API ${resp.status}: ${await resp.text()}`);
  const data = (await resp.json()) as TokenResponse;
  return {
    token: data.access,
    headers: {
      "anthropic-dangerous-direct-browser-access": "true",
      "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
      "x-app": "cli",
    },
  };
}

export async function getCodexToken(): Promise<{
  token: string;
  accountId: string;
}> {
  const resp = await fetch(`${TOKEN_URL}/token/codex`);
  if (!resp.ok) throw new Error(`token API ${resp.status}: ${await resp.text()}`);
  const data = (await resp.json()) as TokenResponse;
  // Codex token is a JWT -- extract account_id from the auth.json format
  return { token: data.access, accountId: "" };
}
