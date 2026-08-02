/**
 * Onion-architecture boundary check for NEW backend modules (server/src/modules/**).
 * See .claude/skills/onion-architecture/rules/enforcement.md for the rationale.
 *
 * Every module folder that predates this check is listed in each rule's
 * `from.pathNot` below. A new module folder is automatically covered — don't
 * add it to the exclusion list.
 */

const PRE_EXISTING_MODULES =
  '^src/modules/(agents|polling|pulls|repo-intel|repos|reviews|settings|workspace|_shared)/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-service-to-db',
      severity: 'error',
      comment:
        'service.ts is the application layer — it must not import Drizzle/Postgres or the schema directly. Depend on the module repository interface instead.',
      from: {
        path: '^src/modules/[^/]+/service\\.ts$',
        pathNot: PRE_EXISTING_MODULES,
      },
      to: {
        // schema.ts/schema/ (table defs) and client.ts (the live connection) are
        // infra; db/rows.ts (plain inferred row types) is allowed — it's the
        // same role as a DTO type at the port boundary.
        path: '^src/db/(schema|client)|node_modules/(drizzle-orm|postgres)/',
      },
    },
    {
      name: 'no-service-to-adapter-impl',
      severity: 'error',
      comment:
        'service.ts must depend on port interfaces (from @devdigest/shared or the module\'s own repository.ts), never on a concrete adapter class.',
      from: {
        path: '^src/modules/[^/]+/service\\.ts$',
        pathNot: PRE_EXISTING_MODULES,
      },
      to: {
        path: '^src/adapters/',
      },
    },
    {
      name: 'no-routes-to-db-or-adapter',
      severity: 'error',
      comment:
        'routes.ts is the HTTP adapter — it must go through service.ts, not touch the DB or another adapter directly.',
      from: {
        path: '^src/modules/[^/]+/routes\\.ts$',
        pathNot: PRE_EXISTING_MODULES,
      },
      to: {
        path: '^src/db/(schema|client)|^src/adapters/',
      },
    },
    {
      name: 'no-helpers-to-io',
      severity: 'error',
      comment:
        'helpers.ts holds pure functions only — no DB, no adapters, no reaching into the composition root.',
      from: {
        path: '^src/modules/[^/]+/helpers\\.ts$',
        pathNot: PRE_EXISTING_MODULES,
      },
      to: {
        path: '^src/db/|^src/adapters/|^src/platform/container\\.ts$',
      },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    doNotFollow: {
      path: 'node_modules',
    },
    exclude: {
      path: '\\.(test|it\\.test)\\.ts$',
    },
  },
};
