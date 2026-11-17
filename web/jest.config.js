/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.[tj]sx?$': [
      'babel-jest',
      {
        presets: [
          [
            '@babel/preset-env',
            {
              targets: {
                node: 'current',
              },
            },
          ],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!((@holochain/(client|serialization))|@theweave/api|@noble/ed25519|emittery|lodash-es|zod-models).*)',
  ],
  moduleNameMapper: {
    '\\.(scss|sass|css|less)$': '<rootDir>/test/styleMock.js',
    '\\.(svg|png|jpe?g|gif|webp|woff2?|ttf|eot|mp3|wav)$':
      '<rootDir>/test/fileMock.js',
  },
  setupFiles: ['<rootDir>/test/jest.setup.ts'],
  globals: {
    __MAIN_APP_ID__: 'test-main-app-id',
    __ADMIN_PORT__: '8000',
    __APP_PORT__: '8000',
  },
}
