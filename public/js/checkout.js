import {
  apiRequest,
  formatMoney,
  getPlanFromLocation,
  getToken,
  setNotice,
} from './api.js';

const planSelect = document.querySelector('#plan');
const priceElement = document.querySelector('#price');
const periodElement = document.querySelector('#period');
const content = document.querySelector('#payment-content');
const notice = document.querySelector('#checkout-notice');
let plans = {};
let activeMethod = 'pago_movil';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function makeField(labelText, name, options = {}) {
  const wrapper = element('div');
  const label = element('label', 'mb-2 block text-sm font-medium', labelText);
  label.htmlFor = name;
  const input = element(options.multiline ? 'textarea' : 'input',
    'w-full rounded-xl border border-white/10 bg-ink px-4 py-3 text-sm outline-none transition placeholder:text-slate-600 focus:border-mint/60');
  input.id = name;
  input.name = name;
  input.required = options.required ?? true;
  if (options.multiline) {
    input.rows = 2;
  } else {
    input.type = options.type || 'text';
    input.autocomplete = options.autocomplete || 'off';
    if (options.maxlength) input.maxLength = options.maxlength;
  }
  if (options.placeholder) input.placeholder = options.placeholder;
  wrapper.append(label, input);
  return { wrapper, input };
}

function renderManualForm(method) {
  content.replaceChildren();
  const heading = element('h3', 'text-base font-semibold',
    method === 'pago_movil' ? 'Paga desde tu banco en Venezuela' : 'Transfiere con Facebank o Pipol Pay');
  const details = element('div', 'my-4 rounded-xl border border-white/5 bg-ink/60 p-4 text-sm');
  const status = element('p', 'text-sm text-slate-400', 'Cargando instrucciones…');
  details.append(status);
  content.append(heading, details);

  const qr = element('img', 'mx-auto mb-4 hidden size-48 rounded-xl bg-white p-2');
  qr.alt = 'Código QR de pago';
  if (method === 'pago_movil') content.append(qr);
  const fields = element('div', 'grid gap-4 sm:grid-cols-2');
  const reference = makeField('Referencia de pago', 'payment-reference', {
    placeholder: 'Número de referencia',
    maxlength: 160,
  });
  const proof = makeField('Comprobante (URL opcional)', 'payment-proof', {
    type: 'url',
    required: false,
    placeholder: 'https://…',
    maxlength: 2048,
  });
  fields.append(reference.wrapper, proof.wrapper);
  content.append(fields);

  const submit = element('button', 'mt-5 w-full rounded-xl bg-mint px-5 py-3 font-semibold text-ink transition hover:bg-white disabled:opacity-60', 'Ya realicé el pago · Enviar referencia');
  const form = element('form', 'mt-1');
  form.append(submit);
  content.append(form);

  const renderDetails = (data) => {
    details.replaceChildren();
    const rows = method === 'pago_movil'
      ? [
          ['Titular', data.accountHolder],
          ['Banco', `${data.bank} (${data.bankCode})`],
          ['Teléfono', data.phone],
          ['Documento', data.nationalId],
          ['Monto', formatMoney(data.amount, data.currency)],
        ]
      : [
          ['Titular', data.accountHolder],
          ['Routing', data.routingNumber],
          ['Cuenta', data.accountNumber],
          ['Pipol Pay', data.pipolPayEmail],
        ];
    for (const [label, value] of rows) {
      const row = element('p', 'flex justify-between gap-4 py-1.5');
      row.append(element('span', 'text-slate-500', label), element('span', 'break-all text-right text-slate-200', value || '—'));
      details.append(row);
    }
    if (data.instructions) details.append(element('p', 'mt-3 border-t border-white/10 pt-3 text-xs leading-5 text-slate-400', data.instructions));
    if (method === 'pago_movil' && data.qr) {
      qr.src = data.qr;
      qr.classList.remove('hidden');
      if (data.qrPayloadFormat === 'gateway-json-not-a-bank-standard') {
        details.append(element('p', 'mt-2 text-xs text-amber-200', 'Este QR es informativo. Usa los datos anteriores para pagar en la app de tu banco.'));
      }
    }
  };

  const endpoint = method === 'pago_movil'
    ? `/payments/pago-movil/info?plan=${encodeURIComponent(planSelect.value)}`
    : '/payments/facebank/info';
  apiRequest(endpoint).then(renderDetails).catch((error) => {
    status.textContent = error.message;
    status.className = 'text-sm text-rose-200';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    setNotice(notice, '');
    try {
      const result = await apiRequest(`/payments/${method === 'pago_movil' ? 'pago-movil' : 'facebank'}/report`, {
        method: 'POST',
        body: {
          plan: planSelect.value,
          reference: reference.input.value.trim(),
          proofUrl: proof.input.value.trim() || undefined,
        },
      });
      setNotice(notice, `Referencia recibida. Estado: ${result.status}. Te avisaremos al aprobar el pago.`, 'success');
      form.reset();
    } catch (error) {
      setNotice(notice, error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });
}

async function createBinanceOrder() {
  content.replaceChildren(element('p', 'text-sm text-slate-400', 'Creando orden de Binance Pay…'));
  const result = await apiRequest('/payments/binance/create-order', {
    method: 'POST',
    body: { plan: planSelect.value },
  });
  content.replaceChildren(
    element('h3', 'font-semibold', 'Orden de Binance Pay lista'),
    element('p', 'mt-2 text-sm text-slate-400', `Total: ${formatMoney(result.amount, result.currency)} · Ref. ${result.reference}`),
  );
  if (result.qrCode) {
    const image = element('img', 'mx-auto mt-5 max-h-56 max-w-full rounded-xl bg-white p-2');
    image.src = result.qrCode;
    image.alt = 'Código de pago de Binance Pay';
    content.append(image);
  }
  const checkoutUrl = result.checkoutUrl || result.deeplink || result.qrCode;
  if (checkoutUrl) {
    const link = element('a', 'mt-5 inline-flex rounded-xl bg-mint px-5 py-3 font-semibold text-ink hover:bg-white', 'Abrir Binance Pay →');
    link.href = checkoutUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    content.append(link);
  } else {
    content.append(element('p', 'mt-4 text-sm text-amber-200', `ID de orden: ${result.orderId}`));
  }
  content.append(element('p', 'mt-4 text-xs text-slate-500', 'La suscripción se activa al confirmar el pago mediante el webhook del proveedor.'));
}

async function createPaypalOrder() {
  content.replaceChildren(element('p', 'text-sm text-slate-400', 'Creando orden de PayPal…'));
  const result = await apiRequest('/payments/paypal/create-order', {
    method: 'POST',
    body: { plan: planSelect.value },
  });
  const approveUrl = result.links?.find((link) => link.rel === 'approve')?.href;
  content.replaceChildren(
    element('h3', 'font-semibold', 'Orden de PayPal lista'),
    element('p', 'mt-2 text-sm text-slate-400', `Total: ${formatMoney(plans[planSelect.value]?.priceUsd, 'USD')}`),
  );
  localStorage.setItem('waGatewayPaypalOrderId', result.orderId);
  if (approveUrl) {
    const link = element('a', 'mt-5 inline-flex rounded-xl bg-mint px-5 py-3 font-semibold text-ink hover:bg-white', 'Continuar a PayPal →');
    link.href = approveUrl;
    link.rel = 'noopener noreferrer';
    content.append(link);
  }
  content.append(element('p', 'mt-4 text-xs leading-5 text-slate-500', 'Después de aprobar el pago en PayPal, volverás aquí y se confirmará la orden.'));
}

async function capturePaypalReturn() {
  const params = new URLSearchParams(location.search);
  const orderId = params.get('token');
  if (!orderId || !params.has('PayerID')) return false;
  content.replaceChildren(element('p', 'text-sm text-slate-300', 'Confirmando tu pago de PayPal…'));
  try {
    await apiRequest('/payments/paypal/capture-order', {
      method: 'POST',
      body: { orderId },
    });
    localStorage.removeItem('waGatewayPaypalOrderId');
    history.replaceState({}, '', '/checkout.html');
    setNotice(notice, '¡Pago confirmado! Tu suscripción se está activando. Ya puedes ir al dashboard.', 'success');
    const dashboard = element('a', 'mt-5 inline-flex rounded-xl bg-mint px-5 py-3 font-semibold text-ink', 'Ir al dashboard →');
    dashboard.href = '/dashboard.html';
    content.append(dashboard);
  } catch (error) {
    setNotice(notice, error.message, 'error');
  }
  return true;
}

async function selectMethod(method) {
  activeMethod = method;
  document.querySelectorAll('.method-tab').forEach((button) => {
    const selected = button.dataset.method === method;
    button.className = `method-tab rounded-xl border px-3 py-3 text-sm font-medium ${
      selected
        ? 'border-mint/50 bg-mint/10 text-mint'
        : 'border-white/10 text-slate-300 hover:border-white/25'
    }`;
  });
  setNotice(notice, '');

  try {
    if (method === 'pago_movil' || method === 'facebank') {
      renderManualForm(method);
    } else if (method === 'binance') {
      await createBinanceOrder();
    } else {
      await createPaypalOrder();
    }
  } catch (error) {
    content.replaceChildren();
    setNotice(notice, error.message, 'error');
  }
}

function updatePrice() {
  const plan = plans[planSelect.value];
  priceElement.textContent = Number.isFinite(plan?.priceUsd)
    ? formatMoney(plan.priceUsd, 'USD')
    : 'No disponible';
  periodElement.textContent = plan?.durationDays
    ? `Cada ${plan.durationDays} días`
    : 'Contacta al administrador para consultar el precio.';
}

document.querySelectorAll('.method-tab').forEach((button) => {
  button.addEventListener('click', () => void selectMethod(button.dataset.method));
});
planSelect.addEventListener('change', () => {
  updatePrice();
  void selectMethod(activeMethod);
});

if (!getToken()) {
  location.href = `/login.html?next=${encodeURIComponent('/checkout.html' + location.search)}`;
} else {
  planSelect.value = getPlanFromLocation();
  try {
    const result = await apiRequest('/plans', { auth: false });
    plans = result.plans || {};
  } catch {
    // Payment endpoints provide the actionable configuration error if plans are unavailable.
  }
  updatePrice();
  const handledReturn = await capturePaypalReturn();
  if (!handledReturn) await selectMethod(activeMethod);
}
