"use client";

import { useLocale } from "next-intl";
import { enUS, es, ko, type Locale } from "date-fns/locale";

const DATE_LOCALES: Record<string, Locale> = { en: enUS, es, ko };

/** date-fns locale that follows the active next-intl locale. */
export function useDateLocale(): Locale {
  return DATE_LOCALES[useLocale()] ?? enUS;
}
