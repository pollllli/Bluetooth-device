let storage = {};

export const setItem = async (key, value) => {
  storage[key] = value;
};

export const getItem = async (key) => {
  return storage[key] || null;
};

export const removeItem = async (key) => {
  delete storage[key];
};

export const multiGet = async (keys) => {
  return keys.map(key => [key, storage[key] || null]);
};

export const multiSet = async (pairs) => {
  pairs.forEach(([key, value]) => {
    storage[key] = value;
  });
};

export const clear = async () => {
  storage = {};
};

export default {
  setItem,
  getItem,
  removeItem,
  multiGet,
  multiSet,
  clear,
};
