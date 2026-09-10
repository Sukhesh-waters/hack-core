/** Degradation ladder switches — features stay dark until env unlocks them. */
export function metaConnectorEnabled(): boolean {
  return process.env.META_CONNECTOR_ENABLED === "true";
}

export function apifyConfigured(): boolean {
  return Boolean(process.env.APIFY_TOKEN);
}

/** Quality tier tries Bedrock only when full AWS credentials are present. */
export function bedrockConfigured(): boolean {
  return Boolean(
    process.env.AWS_REGION &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY,
  );
}
