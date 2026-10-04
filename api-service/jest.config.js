/** Jest runs in native ESM mode (the whole repo is "type": "module"). */
export default {
  testEnvironment: 'node',
  transform: {},
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/index.js'],
  moduleNameMapper: {
    '^@arm/shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^@arm/shared$': '<rootDir>/../shared/src/index.js',
  },
  verbose: true,
};
