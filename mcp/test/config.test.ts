import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_API_BASE, DEFAULT_RUN_TIMEOUT_MS, getApiBase, getRunTimeoutMs } from '../src/config.js';

describe('getApiBase', () => {
  it('returns the default when unset', () => {
    expect(getApiBase({})).toBe(DEFAULT_API_BASE);
  });

  it('returns a valid override as-is', () => {
    expect(getApiBase({ DEVDIGEST_API_BASE: 'http://example.com:4000' })).toBe('http://example.com:4000');
  });

  it('throws ConfigError for a malformed URL', () => {
    expect(() => getApiBase({ DEVDIGEST_API_BASE: 'not-a-url' })).toThrow(ConfigError);
  });
});

describe('getRunTimeoutMs', () => {
  it('returns the default when unset', () => {
    expect(getRunTimeoutMs({})).toBe(DEFAULT_RUN_TIMEOUT_MS);
  });

  it('returns a valid override as a number', () => {
    expect(getRunTimeoutMs({ DEVDIGEST_MCP_RUN_TIMEOUT_MS: '5000' })).toBe(5000);
  });

  it.each(['abc', '0', '-100', 'NaN'])('throws ConfigError for invalid value "%s"', (raw) => {
    expect(() => getRunTimeoutMs({ DEVDIGEST_MCP_RUN_TIMEOUT_MS: raw })).toThrow(ConfigError);
  });
});
