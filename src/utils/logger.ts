type ConsoleKeys = keyof typeof console;
type Console = Record<ConsoleKeys, (...args: unknown[]) => void>;

const logger = Object.keys(console).reduce((acc, key) => {
  acc[key as ConsoleKeys] = (...args) => {
    if (
      typeof window === "undefined" ||
      process.env.NODE_ENV === "development"
    ) {
      (console as unknown as Console)[key as ConsoleKeys](...args);
    }
  };

  return acc;
}, {} as Console);

export default logger;
