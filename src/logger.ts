type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

const LOG_LEVEL = (process.env.LOG_LEVEL || 'info') as LogLevel;

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4
};

const currentLevel = levels[LOG_LEVEL] || levels.info;

export const logger = {
  debug: (...args: any[]) => {
    if (currentLevel <= levels.debug) {
      console.log('[DEBUG]', ...args);
    }
  },

  info: (...args: any[]) => {
    if (currentLevel <= levels.info) {
      console.log('[INFO]', ...args);
    }
  },

  warn: (...args: any[]) => {
    if (currentLevel <= levels.warn) {
      console.warn('[WARN]', ...args);
    }
  },

  error: (...args: any[]) => {
    if (currentLevel <= levels.error) {
      console.error('[ERROR]', ...args);
    }
  }
};
