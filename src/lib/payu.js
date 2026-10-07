import { backend as db } from '@/api/backendClient';


// PayU hosted checkout. Only the merchant KEY and the server-generated hash ever
// reach the browser — the merchant salt stays in Base44 backend secrets, and the
// response is verified by the backend function PayU redirects to, not here.
export async function startPayuCheckout({ planId, phone, onError }) {
  let order;
  try {
    const res = await db.functions.invoke("createPayuOrder", {
      planId,
      phone,
      origin: window.location.origin,
      path: window.location.pathname,
    });
    order = res?.data;
  } catch {
    onError && onError("Could not start checkout. Please try again.");
    return;
  }
  if (!order?.action || !order?.fields?.hash) {
    onError && onError(order?.error || "Could not start checkout. Please try again.");
    return;
  }

  // PayU's hosted page must be opened with a real browser form POST. The browser
  // then leaves the app; PayU posts the outcome to the verification function,
  // which redirects the customer back once the payment is confirmed.
  const form = document.createElement("form");
  form.method = "POST";
  form.action = order.action;
  form.style.display = "none";
  Object.entries(order.fields).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value ?? "";
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}