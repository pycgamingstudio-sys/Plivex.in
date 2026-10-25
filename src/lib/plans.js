// Display-only plan catalogue. Checkout IDs are defined by the backend and remain unchanged.
export const PLANS = {
  free: {
    id: "free",
    name: "Free",
    monthly: 0,
    yearly: 0,
    bullets: [
      "30 invoices per month",
      "20 clients and 20 stock items",
      "PDF downloads with Made with Plivex footer",
      "Basic invoicing and expense tracking",
    ],
  },
  basic: {
    id: "basic",
    name: "Basic",
    monthly: 199,
    yearly: 999,
    bullets: [
      "100 invoices per month",
      "200 clients and 200 stock items",
      "PDF downloads without usage credits",
      "Invoicing, quotations, expenses and reports",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthly: 249,
    yearly: 1599,
    bullets: [
      "Up to 3,000 invoices per month",
      "Up to 50,000 clients and stock items",
      "WhatsApp sharing and payment reminders",
      "Team access and lead pipeline",
      "GSTR-1 export, custom logo and multi-currency",
      "Premium invoice designs",
    ],
  },
};

export const PLAN_CHECKOUT_IDS = {
  basicMonthly: "basic_monthly",
  proMonthly: "pro_monthly",
  basicYearly: "basic_yearly",
  enterpriseYearly: "enterprise_yearly",
};

export default PLANS;
