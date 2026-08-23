import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },
  // `src/vendor/shared` (the hand-mirrored @devdigest/shared contracts, see
  // AGENTS.md's "manually copied, not imported" convention) uses relative
  // `.js`-extension specifiers pointing at `.ts` source files — the NodeNext
  // convention `tsc`/Vitest both resolve natively. Next's webpack bundler
  // does not, by default: any *runtime* (value) import that pulls the
  // barrel — or any contract file with its own relative `.js` imports —
  // into the client bundle fails with "Module not found: Can't resolve
  // './contracts/*.js'". Teaching webpack the same `.js`→`.ts` fallback
  // keeps the barrel safely value-importable without forking the vendored
  // files' import style from the server-side mirror.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
