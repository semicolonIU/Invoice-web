// Simple in-memory logger for development
const logs = [];

export const logger = {
  log: (message, data = {}) => {
    const entry = {
      timestamp: new Date().toISOString(),
      type: 'info',
      message,
      data
    };
    logs.unshift(entry);
    if (logs.length > 50) logs.pop();
    console.log(`[INFO] ${message}`, data);
  },
  error: (message, error = {}) => {
    const entry = {
      timestamp: new Date().toISOString(),
      type: 'error',
      message,
      data: error instanceof Error ? { message: error.message, stack: error.stack } : error
    };
    logs.unshift(entry);
    if (logs.length > 50) logs.pop();
    console.error(`[ERROR] ${message}`, error);
  },
  getLogs: () => logs
};
