/**
 * jest mock: expo-file-system / expo-file-system/legacy
 * (真实 RN 环境用 expo-file-system, jest node 环境无法解析其 ESM, 这里提供内存桩)
 */
const EncodingType = { UTF8: 'utf8', Base64: 'base64' };

const _files = new Map();

const FileSystem = {
  documentDirectory: 'file:///mock/documents/',
  cacheDirectory: 'file:///mock/cache/',
  EncodingType,
  getInfoAsync: async (uri) => {
    return { exists: _files.has(uri), isDirectory: false, size: _files.get(uri)?.length || 0, uri };
  },
  readAsStringAsync: async (uri) => _files.get(uri) || '',
  writeAsStringAsync: async (uri, content) => { _files.set(uri, content); },
  makeDirectoryAsync: async () => {},
  copyAsync: async ({ from, to }) => { if (_files.has(from)) _files.set(to, _files.get(from)); },
  deleteAsync: async (uri) => { _files.delete(uri); },
  moveAsync: async ({ from, to }) => { if (_files.has(from)) { _files.set(to, _files.get(from)); _files.delete(from); } },
  readDirectoryAsync: async () => [],
};

module.exports = FileSystem;
module.exports.default = FileSystem;
module.exports.EncodingType = EncodingType;
