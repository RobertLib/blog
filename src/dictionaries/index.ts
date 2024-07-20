import "server-only";

const dictionaries = {
  en: () => import("./en.json").then((module) => module.default),
};

export const getDictionary = (locale = "en" as const) => dictionaries[locale]();
