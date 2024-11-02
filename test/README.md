## E2E Testing

### Requirement

- Package Manager: pnpm
- NodeJS version: 21.5.0
- Library: supertest, supertest-session

### Install

- Install package
```shell
pnpm install
```

### Run

- Use `jest` global or `./node_modules/.bin/jest` local
```shell
jest --testNamePattern=^AppController \(e2e\)  --runTestsByPath ./test/app.e2e-spec.ts
```