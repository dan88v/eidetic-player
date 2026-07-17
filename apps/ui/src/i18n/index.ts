import { en } from "./en";

export const defaultLocale = "en" as const;

const dictionaries = { en } as const;
type Locale = keyof typeof dictionaries;

const activeLocale: Locale = defaultLocale;

export function t(key: string): string {
  const activeDictionary = dictionaries[activeLocale] as Readonly<
    Record<string, string>
  >;
  const fallbackDictionary = dictionaries[defaultLocale] as Readonly<
    Record<string, string>
  >;
  return activeDictionary[key] ?? fallbackDictionary[key] ?? key;
}
