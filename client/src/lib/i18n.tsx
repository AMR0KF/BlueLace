// Flat English-string-keyed dictionary (same ultra-light pattern as the original:
// the English string IS the key; missing keys fall back to English). POS surface +
// common labels are translated; admin depth stays English.
import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type Lang = "en" | "ar";

const LANG_KEY = "shoepos.lang.v1";

const AR: Record<string, string> = {
  "Point of Sale": "نقطة البيع",
  "Dashboard": "لوحة القيادة",
  "Stock": "المخزون",
  "Purchasing": "المشتريات",
  "Customers": "الزبائن",
  "Orders": "الطلبات",
  "Financial": "المالية",
  "Reports": "التقارير",
  "Settings": "الإعدادات",
  "Search shoes...": "ابحث عن الأحذية...",
  "Cart": "السلة",
  "Cart is empty": "السلة فارغة",
  "Subtotal": "المجموع الفرعي",
  "Discount": "الحسم",
  "Tax": "الضريبة",
  "Total": "المجموع",
  "Charge in": "الدفع بـ",
  "Cash (paid in full)": "نقداً (دفع كامل)",
  "Partial / Unpaid": "جزئي / غير مدفوع",
  "Hold": "تعليق",
  "Resume": "متابعة",
  "Cancel": "إلغاء",
  "Clear cart": "إفراغ السلة",
  "Custom item": "بند مخصص",
  "Item name": "اسم البند",
  "Price": "السعر",
  "Add to cart": "أضف إلى السلة",
  "Pick a color": "اختر اللون",
  "Pick a size": "اختر القياس",
  "Tap a size to add it to the cart": "اضغط على القياس لإضافته إلى السلة",
  "Numbers show stock on hand. Red = out, amber = last pair — you can still sell (it goes to review).":
    "الأرقام تمثل المخزون المتوفر. أحمر = نفد، برتقالي = آخر قطعة — يمكنك البيع (يُحوّل للمراجعة).",
  "Done": "تم",
  "added": "مضافة",
  "Out of stock": "نفد المخزون",
  "Hide out of stock": "إخفاء غير المتوفر",
  "left": "متبقي",
  "Quantity": "الكمية",
  "Amount": "المبلغ",
  "Percent": "نسبة مئوية",
  "Reason (required for big discounts)": "السبب (مطلوب للحسومات الكبيرة)",
  "Apply": "تطبيق",
  "Remove": "إزالة",
  "Pick a customer": "اختر الزبون",
  "Paid now": "المدفوع الآن",
  "Remaining due": "المتبقي",
  "Confirm": "تأكيد",
  "Back": "رجوع",
  "Next": "التالي",
  "New balance": "الرصيد الجديد",
  "Walk-in Customer": "زبون عابر",
  "Sale completed": "تمت عملية البيع",
  "Print receipt": "طباعة الإيصال",
  "Receipt": "إيصال",
  "Sign in": "تسجيل الدخول",
  "Username": "اسم المستخدم",
  "PIN": "الرمز السري",
  "Sign out": "تسجيل الخروج",
  "Working offline from last saved data. Sales will sync when the server is back.":
    "تعمل دون اتصال من آخر بيانات محفوظة. ستتم مزامنة المبيعات عند عودة الخادم.",
  "Queued": "قيد الانتظار",
  "queued sale": "عملية قيد الانتظار",
  "queued sales": "عمليات قيد الانتظار",
  "Language": "اللغة",
  "Theme": "المظهر",
};

interface LanguageValue {
  lang: Lang;
  dir: "ltr" | "rtl";
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageValue>({
  lang: "en",
  dir: "ltr",
  setLang: () => {},
  t: (k) => k,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() =>
    localStorage.getItem(LANG_KEY) === "ar" ? "ar" : "en");

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    localStorage.setItem(LANG_KEY, next);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let text = lang === "ar" ? AR[key] ?? key : key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replaceAll(`{${name}}`, String(value));
        }
      }
      return text;
    },
    [lang],
  );

  const value = useMemo<LanguageValue>(
    () => ({ lang, dir: lang === "ar" ? "rtl" : "ltr", setLang, t }),
    [lang, setLang, t],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useT(): LanguageValue {
  return useContext(LanguageContext);
}
