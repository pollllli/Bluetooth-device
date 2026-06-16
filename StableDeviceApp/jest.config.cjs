module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  moduleFileExtensions: ['js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  transformIgnorePatterns: [],
  setupFilesAfterEnv: [],
  globals: {
    __DEV__: true,
  },
  moduleNameMapper: {
    '@react-native-async-storage/async-storage': '<rootDir>/src/services/__tests__/__mocks__/@react-native-async-storage/async-storage.js',
  },
};
