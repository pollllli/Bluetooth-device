// 错误处理工具函数
// 用于统一处理应用中的错误，提供错误日志记录和错误提示

/**
 * 记录错误日志
 * @param {string} message - 错误消息
 * @param {Error} error - 错误对象
 * @param {string} context - 错误发生的上下文
 */
export const logError = (message, error, context = 'Unknown') => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [${context}] ${message}`, error);

  // 这里可以添加更复杂的日志记录逻辑，比如保存到本地存储或发送到服务器
};

/**
 * 处理异步操作错误
 * @param {Function} asyncFunc - 异步函数
 * @param {string} context - 错误发生的上下文
 * @returns {Function} 包装后的异步函数
 */
export const handleAsyncError = (asyncFunc, context = 'Async Operation') => {
  return async (...args) => {
    try {
      return await asyncFunc(...args);
    } catch (error) {
      logError('Async operation failed', error, context);
      throw error;
    }
  };
};

/**
 * 格式化错误消息
 * @param {Error} error - 错误对象
 * @returns {string} 格式化后的错误消息
 */
export const formatErrorMessage = (error) => {
  if (error.message) {
    return error.message;
  } else if (error.code) {
    return `Error code: ${error.code}`;
  } else {
    return 'Unknown error occurred';
  }
};

/**
 * 处理表单验证错误
 * @param {Object} errors - 错误对象
 * @returns {string} 错误消息
 */
export const formatFormErrors = (errors) => {
  const errorMessages = Object.values(errors);
  if (errorMessages.length === 0) return '';
  return errorMessages.join('\n');
};
