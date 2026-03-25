# Technology Stack

**Analysis Date:** 2026-03-25

## Languages

**Primary:**
- TypeScript 5.7.3 - All source code and configuration
- JavaScript - ESLint configuration (`eslint.config.mjs`)

**Supporting:**
- JSON - Configuration files and package manifests

## Runtime

**Environment:**
- Node.js (version constraint in `package.json` via `@types/node` ^22.10.7)

**Package Manager:**
- pnpm (inferred from `pnpm-lock.yaml` and README.md instructions)
- Lockfile: `pnpm-lock.yaml` present

## Frameworks

**Core:**
- NestJS ^11.0.1 - Full-stack framework for building scalable server-side applications
  - `@nestjs/common` ^11.0.1 - Common decorators and utilities
  - `@nestjs/core` ^11.0.1 - Core framework module
  - `@nestjs/platform-express` ^11.0.1 - Express HTTP platform adapter

**CLI & Code Generation:**
- `@nestjs/cli` ^11.0.0 - NestJS command-line interface
- `@nestjs/schematics` ^11.0.0 - Schematic templates for NestJS scaffolding

**Testing:**
- Jest 30.0.0 - Test runner and assertion framework
  - `@nestjs/testing` ^11.0.1 - NestJS testing utilities and TestingModule
  - ts-jest 29.2.5 - Jest transformer for TypeScript
  - supertest 7.0.0 - HTTP assertion library for testing Express/HTTP servers

**Build/Dev:**
- ts-loader 9.5.2 - TypeScript loader for webpack
- ts-node 10.9.2 - TypeScript execution engine for Node.js
- tsconfig-paths 4.2.0 - Path mapping resolution for TypeScript
- source-map-support 0.5.21 - Stack trace mapping for transpiled code

## Key Dependencies

**Critical:**
- reflect-metadata 0.2.2 - Polyfill for decorator metadata (required by NestJS decorators)
- rxjs 7.8.1 - Reactive programming library for async operations

**Type Definitions:**
- `@types/express` 5.0.0 - Express framework types
- `@types/jest` 30.0.0 - Jest test framework types
- `@types/node` 22.10.7 - Node.js built-in module types
- `@types/supertest` 6.0.2 - Supertest library types

## Code Quality Tools

**Linting:**
- ESLint 9.18.0 - JavaScript/TypeScript linter
  - `@eslint/js` 9.18.0 - ESLint core JavaScript rules
  - `typescript-eslint` 8.20.0 - TypeScript-specific ESLint rules
  - `@eslint/eslintrc` 3.2.0 - ESLintRC configuration loader
  - eslint-plugin-prettier 5.2.2 - Prettier integration for ESLint

**Code Formatting:**
- Prettier 3.4.2 - Code formatter
- eslint-config-prettier 10.0.1 - ESLint configuration to disable conflicting rules

**ESLint Configuration:** `eslint.config.mjs`
- Recommended configs from `@eslint/js` and `typescript-eslint`
- Prettier integration via `eslint-plugin-prettier/recommended`
- Key rules: `@typescript-eslint/no-explicit-any` off, `@typescript-eslint/no-floating-promises` warn

**Prettier Configuration:** `.prettierrc`
- Single quotes: enabled
- Trailing commas: all

## Configuration Files

**TypeScript:**
- `tsconfig.json` - Main TypeScript compiler options
  - Target: ES2023
  - Module: nodenext
  - Strict null checks enabled
  - Decorator metadata emission enabled
  - Output directory: `./dist`
- `tsconfig.build.json` - Build-specific TypeScript configuration
  - Extends main tsconfig
  - Excludes test files and node_modules

**NestJS:**
- `nest-cli.json` - NestJS CLI configuration
  - Source root: `src`
  - Delete output directory on build: enabled

**Jest:**
- Configuration embedded in `package.json`
  - Root directory: `src`
  - Test regex: `.*\.spec\.ts$`
  - Transform: ts-jest for TypeScript files
  - Coverage directory: `../coverage`
  - Test environment: node
  - Separate e2e config: `test/jest-e2e.json` (test regex: `.e2e-spec.ts$`)

## Platform Requirements

**Development:**
- Node.js (latest LTS or 22.x recommended based on `@types/node` ^22.10.7)
- pnpm package manager

**Production:**
- Node.js (runtime)
- Environment variable: `PORT` (optional, defaults to 3000)

**Build Output:**
- Distribution directory: `dist/`
- Entry point: `dist/main.js`
- Production start: `node dist/main`

## Scripts

**Development:**
- `pnpm run start` - Run application
- `pnpm run start:dev` - Watch mode with hot reload
- `pnpm run start:debug` - Debug mode with inspector

**Production:**
- `pnpm run build` - Compile TypeScript to JavaScript
- `pnpm run start:prod` - Run compiled application

**Code Quality:**
- `pnpm run format` - Format code with Prettier
- `pnpm run lint` - Lint and fix code with ESLint

**Testing:**
- `pnpm run test` - Run unit tests
- `pnpm run test:watch` - Watch mode for tests
- `pnpm run test:cov` - Run tests with coverage report
- `pnpm run test:debug` - Debug tests with Node inspector
- `pnpm run test:e2e` - Run end-to-end tests

---

*Stack analysis: 2026-03-25*
